/// <reference lib="dom" />
// Renders one lesson stage in a browser (WebGPU, or WebGL2 fallback) for visual checks.
import * as THREE from 'three/webgpu'
import { UNITS } from '../../src/lessons'
import { Lesson, Readout, initialParams } from '../../src/lessons/types'
import { FOV, Orbit } from '../../src/scene/orbit'
import { createBench } from '../../src/scene/bench'
import { clearColor } from '../../src/scene/stage'

declare global {
  interface Window {
    ready?: boolean
    error?: string
  }
}

async function main() {
  const q = new URLSearchParams(location.search)
  const isBench = q.get('lesson') === 'bench'
  const lesson = isBench ? undefined! : UNITS.flatMap((u) => u.lessons).find((l) => l.id === q.get('lesson'))!
  const params = lesson ? { ...initialParams(lesson), ...JSON.parse(q.get('params') ?? '{}') } : {}
  const bench = isBench ? createBench() : null
  if (bench && q.get('xray') === '1') bench.setXray(true)
  const stage = bench
    ? { scene: bench.scene, view: { center: [0, 0, 0], radius: 62 } as { center: [number, number, number]; radius: number; polar?: number; azimuth?: number }, frame: (dt: number) => bench.tick(dt), readouts: () => [] as Readout[] }
    : lesson.build()
  const orbit = new Orbit()
  orbit.frame(new THREE.Vector3(...stage.view.center), Number(q.get('radius') ?? stage.view.radius))
  orbit.polar = Number(q.get('polar') ?? stage.view.polar ?? orbit.polar)
  orbit.azimuth = Number(q.get('azimuth') ?? stage.view.azimuth ?? orbit.azimuth)

  const canvas = document.querySelector('canvas')!
  const renderer = new THREE.WebGPURenderer({ antialias: true, canvas })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.setClearColor(clearColor())
  await renderer.init()

  const camera = new THREE.PerspectiveCamera(FOV, canvas.clientWidth / canvas.clientHeight, 0.5, 2000)
  for (let i = 0; i < Number(q.get('frames') ?? 90); i++) stage.frame(1 / 60, params)
  orbit.apply(camera)
  renderer.render(stage.scene, camera)
  document.title = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2'
  if (!isBench && q.get('chrome') !== '0') drawChrome(lesson, stage.readouts(params))
  window.ready = true
}

main().catch((e) => {
  window.error = String(e?.stack ?? e)
})

// Mirrors LessonScreen's overlays (status bar inset, back pill, legend, readouts) to judge framing.
function drawChrome(lesson: Lesson, readouts: Readout[]) {
  const top = 47 + 8
  const el = (css: string, html = '') => {
    const d = document.createElement('div')
    d.style.cssText = `position:absolute;font-family:-apple-system,system-ui;color:#eef0f4;${css}`
    d.innerHTML = html
    document.body.appendChild(d)
    return d
  }
  el(`left:12px;top:${top}px;background:rgba(31,34,41,.85);padding:6px 12px;border-radius:999px;font-size:15px`, '‹ Learn')
  if (lesson.legend) {
    const rows = lesson.legend
      .map(
        (i) =>
          `<div style="display:flex;align-items:center;gap:6px">${
            i.shape === 'dot'
              ? `<span style="width:9px;height:9px;border-radius:5px;margin:0 2px;background:${i.color}"></span>`
              : `<span style="color:${i.color};font-weight:700;font-size:13px;width:13px;text-align:center">${i.shape === 'arrow-left' ? '←' : '→'}</span>`
          }<span style="font-size:11px">${i.label}</span></div>`,
      )
      .join('')
    el(`right:10px;top:${top}px;background:rgba(31,34,41,.88);border:.5px solid #2d313a;border-radius:10px;padding:6px 9px;display:flex;flex-direction:column;gap:3px`, rows)
  }
  const chips = readouts
    .map(
      (r) =>
        `<div style="background:rgba(31,34,41,.88);border:.5px solid #2d313a;border-radius:10px;padding:6px 10px"><div style="color:#9aa1ad;font-size:11px">${r.label}</div><div style="font-size:15px;font-weight:600">${r.value}</div></div>`,
    )
    .join('')
  el('left:10px;right:10px;bottom:10px;display:flex;flex-wrap:wrap;gap:6px', chips)
}
