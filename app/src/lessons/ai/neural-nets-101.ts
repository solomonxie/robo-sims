import * as THREE from 'three/webgpu'
import { Activation, GATES, Mlp, Sample, TOYS, TOY_SPAN, gateSet, mlpAccuracy, mlpField, mlpForward, mlpInit, mlpParams, mlpTrain, perceptronOut, perceptronRun, seededRng, toySet } from '../../core/physics'
import { createStage } from '../../scene/stage'
import { CLASS_COLORS, GREY, HIGH_V, LABEL, PLAN_VIEW, POWER, RING, WEIGHT_COLORS, addLabel, classField, cursorBar, liveLabel, memoBy, netDiagram, rodPool, scope } from '../fx'
import { Lesson, Params, Readout, Stage, n, opts, pick } from '../types'

const NET = { x: -13.8, y: -0.6, w: 6.4, h: 8.5 }
const FIELD = { x: -1.6, y: -0.4, size: 11 }
const WF = { x: 11, y: -0.2, w: 9.6, h: 8 }
const TOP = 7.6
const TILES = 30
const PLAY = 10
const HOLD = 2.5

type Diagram = ReturnType<typeof netDiagram>

/** Status lines, the network slot (one diagram per layer shape, made on demand), the class field and the right scope. */
function nnStage(scene: THREE.Scene, lo: number, hi: number, axes: [string, string]) {
  const status = liveLabel(scene, [-18.6, TOP + 1.2, 0.3], { size: 0.44, align: 'left' })
  const sub = liveLabel(scene, [-18.6, TOP + 0.4, 0.3], { size: 0.3, color: GREY, align: 'left' })
  const field = classField(scene, [FIELD.x, FIELD.y, 0], TILES, FIELD.size, lo, hi, 260)
  addLabel(scene, axes[0], [FIELD.x, FIELD.y - FIELD.size / 2 - 0.8, 0.3], GREY, 0.3)
  addLabel(scene, axes[1], [FIELD.x - FIELD.size / 2 - 0.4, FIELD.y + FIELD.size / 2 - 0.2, 0.3], GREY, 0.3, 'right')
  const plot = scope(scene, WF.w, WF.h, { divs: [8, 4], zeroAt: 0 })
  plot.group.position.set(WF.x, WF.y, 0)
  const lines = [0, 1, 2].map((i) => liveLabel(scene, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 1.9 - i * 0.75, 0.3], { size: 0.3, align: 'left' }))
  const diagrams = new Map<string, Diagram>()
  const diagram = (sizes: readonly number[], names: string[] = ['x1', 'x2']) => {
    const key = sizes.join('-')
    let d = diagrams.get(key)
    if (!d) {
      d = netDiagram(scene, sizes, [NET.x, NET.y, 0], NET.w, NET.h)
      names.forEach((s, i) => addLabel(d!.group, s, [d!.pos(0, i)[0] - 0.75, d!.pos(0, i)[1], 0], LABEL, 0.34))
      const out = d.pos(sizes.length - 1, 0)
      addLabel(d.group, 'y', [out[0] + 0.75, out[1], 0], LABEL, 0.34)
      if (sizes.length > 2) addLabel(d.group, `${sizes.slice(1, -1).join(' + ')} hidden`, [0, -NET.h / 2 - 0.9, 0], GREY, 0.28)
      diagrams.set(key, d)
    }
    diagrams.forEach((o, k) => (o.group.visible = k === key))
    return d
  }
  return { status, sub, field, plot, lines, diagram }
}

/** Looping replay clock (play, then hold) that restarts when the key changes. */
function replay(total: number) {
  const st = { key: '', t: 0 }
  return (dt: number, key: string) => {
    if (key !== st.key) [st.key, st.t] = [key, 0]
    st.t += dt
    if (st.t > total) st.t = 0
    return st.t
  }
}

const shown = (act: Activation, a: number) => (act === 'sigmoid' ? 2 * a - 1 : act === 'relu' ? Math.min(1, a) : a)
/** Activations scaled to −1…1 for the diagram (inputs ÷ span). */
function litActs(net: Mlp, x: readonly number[], span: number) {
  const { a } = mlpForward(net, x)
  return a.map((row, l) => (l === 0 ? row.map((v) => v / span) : row.map((v) => shown(net[l - 1].act, v))))
}

const plotLoss = (tr: ReturnType<ReturnType<typeof scope>['trace']>, ys: readonly number[], k: number, top: number) => {
  const us: number[] = []
  const vs: number[] = []
  for (let i = 0; i <= k; i++) {
    us.push(i / (ys.length - 1))
    vs.push(-WF.h / 2 + Math.min(1, ys[i] / top) * WF.h)
  }
  tr.points(us, vs)
}

const plotFrame = (scene: THREE.Scene, title: string, left: string, right: string, top: string) => {
  addLabel(scene, title, [WF.x - WF.w / 2, WF.y + WF.h / 2 + 1.0, 0.3], LABEL, 0.32, 'left')
  addLabel(scene, left, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], GREY, 0.28, 'left')
  addLabel(scene, right, [WF.x + WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], GREY, 0.28, 'right')
  addLabel(scene, top, [WF.x + WF.w / 2 + 0.3, WF.y + WF.h / 2 - 0.2, 0.3], GREY, 0.26, 'left')
}

const toneOf = (good: boolean, ok: boolean): Readout['tone'] => (good ? 'ok' : ok ? 'warn' : 'bad')
const pctText = (v: number) => `${Math.round(v * 100)} %`

// --- Perceptron: one neuron with a step output learns AND/OR/NAND by nudging its line; XOR needs a hidden layer. ---

const PC_LO = -0.6
const PC_HI = 1.6
const PC_EPOCHS = 30
const PC_LR = 0.2
const PC_MODELS = { perceptron: 'One neuron (perceptron)', hidden: 'Hidden layer of 2 (backprop)' }
const pcParams = (p: Params) => ({ gate: pick(GATES, p.gate, 'and'), model: pick(PC_MODELS, p.model, 'perceptron'), seed: n(p, 'seed') })
type PcQ = ReturnType<typeof pcParams>
const pcKey = (q: PcQ) => `${q.gate}|${q.model}|${q.seed}`
const pcRun = memoBy(pcKey, (q: PcQ) => {
  const data = gateSet(q.gate, 6, 0.12, 1)
  const rng = seededRng(q.seed)
  const w0: [number, number] = [rng() * 2 - 1, rng() * 2 - 1]
  const b0 = rng() - 0.5
  const run = perceptronRun(data, PC_LR, PC_EPOCHS, w0, b0)
  const mlp = q.model === 'hidden' ? mlpTrain(mlpInit([2, 2, 1], ['tanh', 'sigmoid'], q.seed), data, { lr: 1, epochs: 400, loss: 'bce', snaps: 80 }) : null
  return { data, run, w0, b0, mlp, rate: Math.min(60, Math.max(8, run.steps.length / PLAY)) }
})

/** Segment of w·x + b = 0 inside the square [lo, hi]², or null. */
function lineInBox(w: readonly number[], b: number, lo: number, hi: number): [number, number][] | null {
  const pts: [number, number][] = []
  for (const x of [lo, hi]) if (Math.abs(w[1]) > 1e-9) pts.push([x, -(w[0] * x + b) / w[1]])
  for (const y of [lo, hi]) if (Math.abs(w[0]) > 1e-9) pts.push([-(w[1] * y + b) / w[0], y])
  const inside = pts.filter(([x, y]) => x >= lo - 1e-9 && x <= hi + 1e-9 && y >= lo - 1e-9 && y <= hi + 1e-9)
  return inside.length >= 2 ? [inside[0], inside[inside.length - 1]] : null
}

export const neuralNets101Perceptron: Lesson = {
  id: 'neural-nets-101-perceptron',
  title: 'Perceptron',
  tagline: 'One artificial neuron: weigh the inputs, add a bias, fire if the sum is positive. It learns any rule a straight line can split, and nothing else',
  formula: (p) =>
    pcParams(p).model === 'perceptron'
      ? 'y = 1 if w₁x₁ + w₂x₂ + b > 0, else 0 · on a mistake: w ← w + η (t − y) x, b ← b + η (t − y) · η = 0.2'
      : 'h = tanh(W₁x + b₁) · y = σ(W₂h + b₂) · trained by gradient descent on the cross-entropy loss',
  legend: [
    { color: CLASS_COLORS[1], label: 'Target 1 (dots) and where the net says 1 (tiles)', shape: 'dot' },
    { color: CLASS_COLORS[0], label: 'Target 0, and where the net says 0', shape: 'dot' },
    { color: WEIGHT_COLORS.pos, label: 'Positive weight (thicker = bigger)', shape: 'dot' },
    { color: WEIGHT_COLORS.neg, label: 'Negative weight', shape: 'dot' },
    { color: '#ffffff', label: 'Sample being tried; the decision line (yellow: w)', shape: 'dot' },
  ],
  points: [
    'Frank Rosenblatt\'s perceptron (1958) is the neuron every net is built from. It multiplies each input by a weight, adds a bias and fires if the total is above zero. The inputs here are two noisy logic levels, like two IR obstacle sensors, and the output is what the robot should do. The weights and bias define a straight line across the input plane: one side fires, the other does not.',
    'Learning is a nudge: show a sample, and if the answer is wrong, add η·x to the weights (or subtract it), which tips the line toward the right side of that point. If a straight line can split the two classes, this rule is guaranteed to find one in a finite number of mistakes (the perceptron convergence theorem). AND, OR and NAND settle in a pass or two from any start.',
    'XOR fires when exactly one input is high. The 1s sit on one diagonal and the 0s on the other, and no single line splits them: the perceptron keeps making mistakes forever. Minsky and Papert pointed this out in 1969 and it stalled the field for a decade.',
    'The fix is a hidden layer. Two tanh neurons each draw their own line; the output neuron combines the two half-planes into a band. Step outputs have no slope to learn from, so the net uses smooth activations and gradient descent (next lesson). Some starts get stuck with one hidden neuron doing nothing useful: try another start.',
  ],
  controls: [
    { kind: 'choice', key: 'gate', options: opts(GATES), initial: 'and' },
    { kind: 'choice', key: 'model', options: opts(PC_MODELS), initial: 'perceptron' },
    { kind: 'slider', key: 'seed', label: 'Starting weights', min: 1, max: 9, step: 1, initial: 2, format: (v: number) => `#${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = nnStage(scene, PC_LO, PC_HI, ['sensor x1 (0 … 1)', 'x2'])
    const line = rodPool(scene, 1)
    const normal = rodPool(scene, 1, { heads: true })
    const curve = s.plot.trace(RING, { samples: 100, radius: 0.08 })
    const titleL = liveLabel(scene, [WF.x - WF.w / 2, WF.y + WF.h / 2 + 1.0, 0.3], { size: 0.32, align: 'left' })
    const rightL = liveLabel(scene, [WF.x + WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], { size: 0.28, color: GREY, align: 'right' })
    const topL = liveLabel(scene, [WF.x + WF.w / 2 + 0.3, WF.y + WF.h / 2 - 0.2, 0.3], { size: 0.26, color: GREY, align: 'left' })
    const leftL = liveLabel(scene, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], { size: 0.28, color: GREY, align: 'left' })
    const bias = liveLabel(scene, [NET.x, NET.y - NET.h / 2 - 0.9, 0.3], { size: 0.3, color: GREY })
    const timer = replay(PLAY + HOLD)
    const vals = new Float32Array(TILES * TILES)
    const st = { sig: '' }
    return {
      scene,
      view: PLAN_VIEW,
      frame(dt, p) {
        const q = pcParams(p)
        const key = pcKey(q)
        const R = pcRun(q)
        const t = timer(dt, key)
        if (q.model === 'perceptron') {
          const steps = R.run.steps
          const k = Math.min(steps.length - 1, Math.floor(t * R.rate))
          if (st.sig === `${key}|${k}`) return
          st.sig = `${key}|${k}`
          const step = steps[k]
          const smp = R.data[step.i]
          const pass = Math.floor(k / R.data.length)
          for (let r = 0; r < TILES; r++)
            for (let c = 0; c < TILES; c++) vals[r * TILES + c] = perceptronOut(step.w, step.b, [PC_LO + ((c + 0.5) / TILES) * (PC_HI - PC_LO), PC_HI - ((r + 0.5) / TILES) * (PC_HI - PC_LO)]) ? 0.92 : 0.08
          s.field.paint(vals)
          s.field.samples(R.data, [], (i) => (i === step.i ? 1.6 : 1))
          s.field.probe(smp.x, step.wrong ? HIGH_V : '#ffffff')
          const seg = lineInBox(step.w, step.b, PC_LO, PC_HI)
          if (seg) {
            line.set(0, s.field.toScene(...seg[0], 0.3), s.field.toScene(...seg[1], 0.3), 0.05, '#ffffff')
            const mid: [number, number] = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2]
            const wn = Math.hypot(step.w[0], step.w[1])
            normal.set(0, s.field.toScene(...mid, 0.3), s.field.toScene(mid[0] + (0.35 * step.w[0]) / wn, mid[1] + (0.35 * step.w[1]) / wn, 0.3), 0.04, RING)
          } else [line, normal].forEach((o) => o.hideFrom(0))
          line.commit()
          normal.commit()
          const net: Mlp = [{ act: 'linear', W: [[step.w[0], step.w[1]]], b: [step.b] }]
          s.diagram([2, 1]).set(net, [smp.x, [step.y ? 1 : -0.2]], 1.5)
          bias.set(`bias b = ${step.b.toFixed(2)}`, GREY)
          const ms = R.run.mistakes.slice(0, pass + 1)
          plotLoss(curve, [...ms, ...new Array(Math.max(0, PC_EPOCHS - ms.length)).fill(0)].slice(0, PC_EPOCHS), Math.min(pass, PC_EPOCHS - 1), R.data.length)
          titleL.set('mistakes per pass over the 24 samples', LABEL)
          rightL.set(`pass ${PC_EPOCHS}`, GREY)
          leftL.set('pass 0', GREY)
          topL.set('24', GREY)
          const done = R.run.converged !== null && pass >= R.run.converged
          s.lines[0].set(`pass ${pass + 1} · sample ${(k % R.data.length) + 1}: wants ${smp.t[0]}, says ${step.y}${step.wrong ? ' → nudge' : ' ✓'}`, step.wrong ? HIGH_V : POWER)
          s.lines[1].set(`w = (${step.w[0].toFixed(2)}, ${step.w[1].toFixed(2)}), b = ${step.b.toFixed(2)}`, GREY)
          s.lines[2].set(done ? `no mistakes in pass ${R.run.converged! + 1}: learned` : R.run.converged === null ? 'no line splits these: it never settles' : 'still learning', done ? POWER : R.run.converged === null ? HIGH_V : RING)
          s.status.set(`Perceptron · ${GATES[q.gate]} · start #${q.seed}`, LABEL)
          s.sub.set(`24 noisy samples (6 per truth-table row) · η = ${PC_LR} · ${R.rate.toFixed(0)} samples/s`)
          return
        }
        const M = R.mlp!
        const k = Math.min(M.nets.length - 1, Math.floor((t / PLAY) * M.nets.length))
        const probeI = Math.floor(t / 0.6) % 4
        if (st.sig === `${key}|${k}|${probeI}`) return
        st.sig = `${key}|${k}|${probeI}`
        const net = M.nets[k].net
        s.field.paint(mlpField(net, TILES, PC_LO, PC_HI))
        const smp = R.data[probeI]
        s.field.samples(R.data, [], (i) => (i === probeI ? 1.6 : 1))
        s.field.probe(smp.x)
        for (const o of [line, normal]) {
          o.hideFrom(0)
          o.commit()
        }
        s.diagram([2, 2, 1]).set(net, litActs(net, smp.x, 1))
        bias.set('', GREY)
        plotLoss(curve, M.curve.map((c) => c.train), k, 0.8)
        titleL.set('cross-entropy loss over the 24 samples', LABEL)
        rightL.set('400', GREY)
        leftL.set('epoch 0', GREY)
        topL.set('0.8', GREY)
        const acc = mlpAccuracy(net, R.data)
        const y = mlpForward(net, smp.x).a[2][0]
        s.lines[0].set(`epoch ${M.nets[k].epoch}: loss ${M.curve[k].train.toFixed(3)}, ${pctText(acc)} right`, acc === 1 ? POWER : RING)
        s.lines[1].set(`input (${smp.x[0].toFixed(0)}, ${smp.x[1].toFixed(0)}) → y = ${y.toFixed(2)} (target ${smp.t[0]})`, GREY)
        s.lines[2].set(acc === 1 ? 'two lines make a band: solved' : k === M.nets.length - 1 ? 'stuck: try another start' : 'training', acc === 1 ? POWER : k === M.nets.length - 1 ? HIGH_V : RING)
        s.status.set(`2-2-1 net · ${GATES[q.gate]} · start #${q.seed}`, LABEL)
        s.sub.set('tanh hidden, sigmoid output · gradient descent, learning rate 1 · probe cycles the four corners')
      },
      readouts: (p) => {
        const q = pcParams(p)
        const R = pcRun(q)
        if (q.model === 'hidden') {
          const M = R.mlp!
          const acc = mlpAccuracy(M.net, R.data)
          return [
            { label: 'Accuracy after 400 epochs', value: pctText(acc), tone: toneOf(acc === 1, acc >= 0.75) },
            { label: 'Final loss', value: M.curve[M.curve.length - 1].train.toFixed(3) },
            { label: 'Weights + biases', value: `${mlpParams(M.net)}` },
            { label: 'Perceptron on the same data', value: R.run.converged === null ? 'never settles' : `${R.run.converged + 1} passes` },
          ]
        }
        const last = R.run.mistakes[R.run.mistakes.length - 1]
        return [
          { label: 'Result', value: R.run.converged === null ? `no line after ${PC_EPOCHS} passes` : `learned in ${R.run.converged + 1} passes`, tone: R.run.converged === null ? 'bad' : 'ok' },
          { label: 'Mistakes in the last pass', value: `${last} of ${R.data.length}`, tone: last ? 'warn' : 'ok' },
          { label: 'Final w₁, w₂, b', value: `${R.run.w[0].toFixed(2)}, ${R.run.w[1].toFixed(2)}, ${R.run.b.toFixed(2)}` },
          { label: 'Weight updates', value: `${R.run.steps.filter((x) => x.wrong).length}` },
        ]
      },
    }
  },
}

// --- Gradient descent: backprop gives the slope of the loss for every weight; step downhill, too small crawls, too big blows up. ---

const GD_N = 100
const GD_EPOCHS = 400
const GD_ACTS = { tanh: 'tanh hidden', relu: 'ReLU hidden', sigmoid: 'Sigmoid hidden' }
const gdParams = (p: Params) => ({ toy: pick(TOYS, p.toy, 'moons'), act: pick(GD_ACTS, p.act, 'tanh') as Activation, lr: n(p, 'lr'), hidden: n(p, 'hidden') })
type GdQ = ReturnType<typeof gdParams>
const gdKey = (q: GdQ) => `${q.toy}|${q.act}|${q.lr}|${q.hidden}`
const gdRun = memoBy(gdKey, (q: GdQ) => {
  const data = toySet(q.toy, GD_N, 0.1, 3)
  const r = mlpTrain(mlpInit([2, q.hidden, 1], [q.act, 'sigmoid'], 2), data, { lr: q.lr, epochs: GD_EPOCHS, loss: 'bce', snaps: 80 })
  const ok = r.curve.every((c) => Number.isFinite(c.train))
  const last = r.curve[r.curve.length - 1]
  const rises = r.curve.slice(1).filter((c, i) => c.train > r.curve[i].train + 1e-3).length
  return { data, ...r, acc: mlpAccuracy(r.net, data), last, verdict: (!ok || last.train > r.curve[0].train ? 'diverged' : rises > 8 ? 'bouncing' : last.train > 0.3 ? 'slow or stuck' : 'converged') as keyof typeof VERDICTS }
})
const VERDICTS = { converged: 'loss settled low: converged', bouncing: 'loss bounces: steps overshoot the valley', 'slow or stuck': 'still high: steps too small, or too few neurons', diverged: 'loss went up: the steps blew it apart' }
const LOSS_LO = -3
const LOSS_HI = 1
const logY = (v: number) => (Math.log10(Math.max(1e-3, Math.min(10, v))) - LOSS_LO) / (LOSS_HI - LOSS_LO)

export const neuralNets101GradientDescent: Lesson = {
  id: 'neural-nets-101-gradient-descent',
  title: 'Gradient descent',
  tagline: 'Backprop finds how the loss changes with every weight; take a small step downhill and repeat. The step size decides whether it crawls, lands or blows up',
  formula: 'L = −mean[t ln y + (1 − t) ln(1 − y)] · w ← w − η ∂L/∂w · ∂L/∂w by the chain rule, output layer back to input (backprop)',
  legend: [
    { color: CLASS_COLORS[1], label: 'Class 1 and the region the net calls 1', shape: 'dot' },
    { color: CLASS_COLORS[0], label: 'Class 0 and its region; pale seam = boundary', shape: 'dot' },
    { color: WEIGHT_COLORS.pos, label: 'Positive weight / bright neuron = active', shape: 'dot' },
    { color: WEIGHT_COLORS.neg, label: 'Negative weight', shape: 'dot' },
    { color: RING, label: 'Training loss (log scale)', shape: 'dot' },
  ],
  points: [
    'A net is a function with knobs: y = f(x; w). The loss scores how wrong it is on the training set; cross-entropy punishes a confident wrong answer hardest. Training means finding knobs that make the loss small, and with hundreds of knobs there is no formula for that, so we walk downhill.',
    'Backpropagation gets the slope for every weight in one backward pass: the error at the output is passed back through each layer, multiplied by the weights and by each neuron\'s slope (the chain rule). The tests check it against finite differences, nudging each weight by 10⁻⁵ and watching the loss. Then every weight moves a step η against its slope.',
    'The learning rate η is the step size. Too small and the loss crawls; the boundary barely bends in 400 epochs. About right and it drops in a few hundred. Too big and each step jumps over the valley: the loss bounces or explodes. Real training uses mini-batches (SGD) and adaptive steps like Adam, but the idea is the same.',
    'Hidden neurons set how bendy the boundary can be: one neuron is one line, a ring needs at least three. The activation matters too: sigmoid saturates and learns slowly, tanh is centred on zero, ReLU is cheap and makes boundaries out of straight pieces. These are the nets TinyML squeezes onto an ESP32 next.',
  ],
  controls: [
    { kind: 'choice', key: 'toy', options: opts(TOYS), initial: 'moons' },
    { kind: 'choice', key: 'act', options: opts(GD_ACTS), initial: 'tanh' },
    { kind: 'slider', key: 'lr', label: 'Learning rate η', min: 0.01, max: 20, initial: 1, log: true, format: (v: number) => (v < 0.1 ? v.toFixed(3) : v < 1 ? v.toFixed(2) : v.toFixed(1)) },
    { kind: 'slider', key: 'hidden', label: 'Hidden neurons', min: 1, max: 8, step: 1, initial: 6, format: (v: number) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = nnStage(scene, -TOY_SPAN, TOY_SPAN, ['x1', 'x2'])
    const curve = s.plot.trace(RING, { samples: 100, radius: 0.08 })
    plotFrame(scene, 'training loss (log: 0.001 … 10)', 'epoch 0', `${GD_EPOCHS}`, '10')
    s.plot.level(GREY).set(-WF.h / 2 + logY(Math.LN2) * WF.h)
    addLabel(scene, 'guessing (0.69)', [WF.x + WF.w / 2 + 0.3, WF.y - WF.h / 2 + logY(Math.LN2) * WF.h, 0.3], GREY, 0.24, 'left')
    const timer = replay(PLAY + HOLD)
    const st = { key: '', k: -1, probe: -1 }
    return {
      scene,
      view: PLAN_VIEW,
      frame(dt, p) {
        const q = gdParams(p)
        const key = gdKey(q)
        const R = gdRun(q)
        const t = timer(dt, key)
        const k = Math.min(R.nets.length - 1, Math.floor((t / PLAY) * R.nets.length))
        const probe = Math.floor(t / 0.5) % R.data.length
        if (k === st.k && probe === st.probe && key === st.key) return
        const net = R.nets[k].net
        if (k !== st.k || key !== st.key) {
          s.field.paint(mlpField(net, TILES, -TOY_SPAN, TOY_SPAN))
          s.field.samples(R.data)
          plotLoss(curve, R.curve.map((c) => (Number.isFinite(c.train) ? logY(c.train) : 1)), k, 1)
        }
        Object.assign(st, { key, k, probe })
        const smp = R.data[probe]
        s.field.probe(smp.x)
        s.diagram([2, q.hidden, 1]).set(net, litActs(net, smp.x, TOY_SPAN))
        const c = R.curve[k]
        const acc = mlpAccuracy(net, R.data)
        s.lines[0].set(`epoch ${c.epoch}: loss ${Number.isFinite(c.train) ? c.train.toFixed(3) : '∞'}, ${pctText(acc)} right`, acc > 0.97 ? POWER : acc > 0.8 ? RING : HIGH_V)
        s.lines[1].set(`slope size |∂L/∂w| = ${Number.isFinite(c.grad) ? c.grad.toFixed(3) : '∞'} · step η = ${q.lr.toPrecision(2)}`, GREY)
        s.lines[2].set(VERDICTS[R.verdict], R.verdict === 'converged' ? POWER : R.verdict === 'diverged' ? HIGH_V : RING)
        s.status.set(`Gradient descent · ${TOYS[q.toy].toLowerCase()} · 2-${q.hidden}-1, ${q.act}`, LABEL)
        s.sub.set(`${GD_N} points, full batch, ${GD_EPOCHS} epochs replayed in ${PLAY} s · probe walks the data`)
      },
      readouts: (p) => {
        const R = gdRun(gdParams(p))
        return [
          { label: 'Final loss', value: Number.isFinite(R.last.train) ? R.last.train.toFixed(3) : '∞', tone: toneOf(R.last.train < 0.1, R.last.train < 0.4) },
          { label: 'Accuracy', value: pctText(R.acc), tone: toneOf(R.acc > 0.97, R.acc > 0.8) },
          { label: 'Training', value: R.verdict, tone: R.verdict === 'converged' ? 'ok' : R.verdict === 'diverged' ? 'bad' : 'warn' },
          { label: 'Weights + biases', value: `${mlpParams(R.net)}` },
        ]
      },
    }
  },
}

// --- Overfitting: a big net memorises a few noisy points; the held-out loss turns up. More data, weight decay or early stopping help. ---

const OF_EPOCHS = 1000
const OF_VAL = 200
const ofParams = (p: Params) => ({ pts: n(p, 'pts'), hidden: n(p, 'hidden'), l2: n(p, 'l2') })
type OfQ = ReturnType<typeof ofParams>
const ofKey = (q: OfQ) => `${q.pts}|${q.hidden}|${q.l2}`
const OF_HELD: Sample[] = toySet('moons', OF_VAL, 0.25, 99)
const ofRun = memoBy(ofKey, (q: OfQ) => {
  const train = toySet('moons', q.pts, 0.25, 5)
  const r = mlpTrain(mlpInit([2, q.hidden, 1], ['tanh', 'sigmoid'], 1), train, { lr: 0.35, epochs: OF_EPOCHS, loss: 'bce', l2: q.l2, val: OF_HELD, snaps: 80 })
  const best = r.curve.reduce((a, c, i) => (c.val < r.curve[a].val ? i : a), 0)
  const last = r.curve[r.curve.length - 1]
  return { train, ...r, best, last, accTrain: mlpAccuracy(r.net, train), accHeld: mlpAccuracy(r.net, OF_HELD), accBest: mlpAccuracy(r.nets[best].net, OF_HELD) }
})
const OF_TOP = 1.2

export const neuralNets101Overfitting: Lesson = {
  id: 'neural-nets-101-overfitting',
  title: 'Overfitting',
  tagline: 'A big net can memorise a few noisy points perfectly and still be wrong on new ones. Judge it on data it never trained on',
  formula: (p) => `train on n points, score on ${OF_VAL} held-out points · loss = cross-entropy${ofParams(p).l2 ? ' + ½ λ Σ w² (weight decay)' : ''} · early stopping: keep the net at the held-out minimum`,
  legend: [
    { color: CLASS_COLORS[1], label: 'Class 1: training dots, held-out rings', shape: 'dot' },
    { color: CLASS_COLORS[0], label: 'Class 0: training dots, held-out rings', shape: 'dot' },
    { color: RING, label: 'Training loss', shape: 'dot' },
    { color: HIGH_V, label: 'Held-out loss', shape: 'dot' },
    { color: POWER, label: 'Held-out minimum: where to stop', shape: 'dot' },
  ],
  points: [
    'The training loss only says how well the net fits the points it was shown. With 16 hidden neurons (65 weights) and a dozen noisy points, it can bend the boundary round every single dot, noise included, and drive the training loss to almost zero. That is memorising, not learning.',
    'So keep some data back. The rings are 200 held-out points the net never trains on. Their loss falls at first, while the net learns the real shape of the two moons, then turns up as it starts fitting the noise. The gap between the two curves is overfitting; the green line marks where the held-out loss was lowest.',
    'Cures: more data (slide the training points up and the gap closes, as the noise averages out); a smaller net (fewer hidden neurons cannot draw such wiggly boundaries); weight decay (a penalty λ·w that pulls every weight toward zero, keeping the boundary smooth); and early stopping (save the net at the held-out minimum).',
    'On a robot this is the classic demo that works on the bench and fails in the hall: a detector trained on 50 photos of one room. Collect varied data, keep a test set from somewhere else, and judge only on that. The same rule returns in Imitation learning and Anomaly detection.',
  ],
  controls: [
    { kind: 'slider', key: 'pts', label: 'Training points', min: 10, max: 40, step: 2, initial: 12, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'hidden', label: 'Hidden neurons', min: 1, max: 16, step: 1, initial: 16, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'l2', label: 'Weight decay λ', min: 0, max: 0.02, step: 0.002, initial: 0, format: (v: number) => (v ? v.toFixed(3) : 'off') },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = nnStage(scene, -TOY_SPAN, TOY_SPAN, ['x1', 'x2'])
    const trainTr = s.plot.trace(RING, { samples: 100, radius: 0.08 })
    const heldTr = s.plot.trace(HIGH_V, { samples: 100, radius: 0.08 })
    const bestBar = cursorBar(s.plot, POWER, 0.08)
    plotFrame(scene, 'cross-entropy: training · held-out', 'epoch 0', `${OF_EPOCHS}`, `${OF_TOP}`)
    const timer = replay(PLAY + HOLD)
    const st = { key: '', k: -1, probe: -1 }
    return {
      scene,
      view: PLAN_VIEW,
      frame(dt, p) {
        const q = ofParams(p)
        const key = ofKey(q)
        const R = ofRun(q)
        const t = timer(dt, key)
        const k = Math.min(R.nets.length - 1, Math.floor((t / PLAY) * R.nets.length))
        const probe = Math.floor(t / 0.6) % R.train.length
        if (k === st.k && probe === st.probe && key === st.key) return
        const net = R.nets[k].net
        if (k !== st.k || key !== st.key) {
          s.field.paint(mlpField(net, TILES, -TOY_SPAN, TOY_SPAN))
          s.field.samples(R.train, OF_HELD)
          plotLoss(trainTr, R.curve.map((c) => c.train), k, OF_TOP)
          plotLoss(heldTr, R.curve.map((c) => c.val), k, OF_TOP)
          bestBar(k >= R.best ? R.best / (R.curve.length - 1) : null)
        }
        Object.assign(st, { key, k, probe })
        const smp = R.train[probe]
        s.field.probe(smp.x)
        s.diagram([2, q.hidden, 1]).set(net, litActs(net, smp.x, TOY_SPAN))
        const c = R.curve[k]
        const accT = mlpAccuracy(net, R.train)
        const accH = mlpAccuracy(net, OF_HELD)
        const gap = c.val - c.train
        s.lines[0].set(`epoch ${c.epoch}: training loss ${c.train.toFixed(3)}, held-out ${c.val.toFixed(3)}`, gap > 0.25 ? HIGH_V : gap > 0.1 ? RING : POWER)
        s.lines[1].set(`right: ${pctText(accT)} of training, ${pctText(accH)} of held-out`, GREY)
        s.lines[2].set(k > R.best && c.val > R.curve[R.best].val + 0.05 ? `past the best (epoch ${R.curve[R.best].epoch}): now fitting noise` : 'held-out loss still falling: learning the shape', k > R.best && c.val > R.curve[R.best].val + 0.05 ? HIGH_V : POWER)
        s.status.set(`Overfitting · ${q.pts} training points · 2-${q.hidden}-1 (${mlpParams(net)} weights)${q.l2 ? ` · λ ${q.l2}` : ''}`, LABEL)
        s.sub.set(`noisy two moons · ${OF_VAL} held-out points never trained on · ${OF_EPOCHS} epochs in ${PLAY} s`)
      },
      readouts: (p) => {
        const R = ofRun(ofParams(p))
        const gap = R.last.val - R.last.train
        return [
          { label: 'Right on training / held-out', value: `${pctText(R.accTrain)} / ${pctText(R.accHeld)}`, tone: toneOf(R.accTrain - R.accHeld < 0.05, R.accTrain - R.accHeld < 0.12) },
          { label: 'Loss gap at the end', value: gap.toFixed(2), tone: toneOf(gap < 0.1, gap < 0.3) },
          { label: 'Best held-out epoch', value: `${R.curve[R.best].epoch}` },
          { label: 'Held-out if stopped there', value: pctText(R.accBest) },
        ]
      },
    }
  },
}
