// Running a detector on a robot: model cost (MACs, weights), chips and accelerators (effective int8 throughput, power),
// per-frame time budget, memory on an ESP32 and how far the robot moves between detections.
import { CPU_HZ, MB, REGION_BYTES } from '../mcu/memory'
import { netCost } from './detect'

/** Effective (not peak) multiply-accumulates per second on conv nets; `host` = ops/s of the CPU that resizes frames and runs NMS. */
export interface Accel { name: string; short: string; int8: number; f32: number; watts: number; memBytes: number; overheadS: number; linkBps: number; host: number }
export const ACCELERATORS: Record<string, Accel> = {
  esp32: { name: 'ESP32 (ESP32-CAM)', short: 'ESP32', int8: 30e6, f32: 8e6, watts: 0.5, memBytes: 4 * MB, overheadS: 0, linkBps: Infinity, host: CPU_HZ / 4 },
  esp32s3: { name: 'ESP32-S3 + ESP-NN SIMD', short: 'S3', int8: 140e6, f32: 20e6, watts: 0.5, memBytes: 8 * MB, overheadS: 0, linkBps: Infinity, host: CPU_HZ / 2 },
  k210: { name: 'Kendryte K210 KPU', short: 'K210', int8: 40e9, f32: 0, watts: 0.3, memBytes: 6 * MB, overheadS: 2e-3, linkBps: Infinity, host: 100e6 },
  pi5: { name: 'Raspberry Pi 5 CPU', short: 'Pi 5', int8: 30e9, f32: 10e9, watts: 6, memBytes: 4096 * MB, overheadS: 1e-3, linkBps: Infinity, host: 2e9 },
  coral: { name: 'Coral USB Edge TPU', short: 'Coral', int8: 120e9, f32: 0, watts: 2, memBytes: 8 * MB, overheadS: 1e-3, linkBps: 200e6, host: 2e9 },
  hailo: { name: 'Hailo-8L (M.2)', short: 'Hailo', int8: 500e9, f32: 0, watts: 1.5, memBytes: 4096 * MB, overheadS: 1e-3, linkBps: 800e6, host: 2e9 },
  jetson: { name: 'Jetson Orin Nano GPU', short: 'Orin', int8: 1200e9, f32: 300e9, watts: 10, memBytes: 4096 * MB, overheadS: 1.5e-3, linkBps: Infinity, host: 3e9 },
}

export interface DetectModel { name: string; w: number; h: number; macs: number; params: number }
const tiny = netCost(48, 36)
/** Rough published sizes (MACs = FLOPs / 2). */
export const DETECT_MODELS: Record<string, DetectModel> = {
  tiny: { name: 'This topic\'s net, 48 × 36', w: 48, h: 36, macs: tiny.macs, params: tiny.params },
  fastest: { name: 'YOLO-Fastest v1.1, 320 × 320', w: 320, h: 320, macs: 0.125e9, params: 0.35e6 },
  ssd: { name: 'SSDLite MobileNet v2, 300 × 300', w: 300, h: 300, macs: 0.8e9, params: 4.3e6 },
  yolov8n: { name: 'YOLOv8n, 640 × 640', w: 640, h: 640, macs: 4.4e9, params: 3.2e6 },
}

export const CAM_FPS = 25

/** One frame through camera → resize → net → NMS. Pipelined: fps is set by the slowest stage, latency by their sum. */
export function frameBudget(a: Accel, m: DetectModel, int8 = true, camFps = CAM_FPS) {
  const rate = int8 ? a.int8 : a.f32
  const bytes = m.params * (int8 ? 1 : 4)
  const fits = rate > 0 && bytes <= a.memBytes
  const preS = (m.w * m.h * 3 * 4) / a.host
  const linkS = Number.isFinite(a.linkBps) ? (m.w * m.h * 3) / a.linkBps : 0
  const netS = fits ? m.macs / rate + a.overheadS + linkS : Infinity
  const postS = 2000 / a.host
  const camS = 1 / camFps
  const sequential = a.overheadS === 0
  const busy = sequential ? preS + netS + postS : Math.max(preS + postS, netS)
  const periodS = Math.max(camS, busy)
  return { fits, bytes, camS, preS, netS, postS, latencyS: camS + preS + netS + postS, fps: 1 / periodS, cameraBound: busy < camS, energyJ: a.watts * netS }
}

/** Bytes the tiny net needs at run time on an ESP32: camera frame (QQVGA RGB565), input, two live activation maps, weights. */
export function tinyMemory(w: number, h: number, int8: boolean) {
  const c = netCost(w, h)
  const b = int8 ? 1 : 4
  const parts = { frame: 160 * 120 * 2, input: w * h * 3 * b, activations: c.peak * b, weights: c.params * b }
  return { ...parts, total: parts.frame + parts.input + parts.activations + parts.weights, sram: REGION_BYTES.dram }
}

/** Metres the robot moves between two detections and while one result is in flight. */
export const travelOf = (speed: number, fps: number, latencyS: number) => ({ between: speed / fps, stale: speed * latencyS })
