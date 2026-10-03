// node tools/preview/shoot.mjs <lesson> <out.png> [query...]  e.g. params='{"amps":2}' polar=1.3
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const three = join(here, '../../node_modules/three/build/three.webgpu.js')
const [lesson, out, ...rest] = process.argv.slice(2)
const query = new URLSearchParams({ lesson, ...Object.fromEntries(rest.map((kv) => kv.split(/=(.*)/s).slice(0, 2))) })

const dir = mkdtempSync(join(tmpdir(), 'lesson-preview-'))
await build({
  entryPoints: [join(here, 'entry.ts')],
  bundle: true,
  format: 'esm',
  outfile: join(dir, 'bundle.js'),
  alias: { three: three, 'three/webgpu': three },
  logLevel: 'error',
})
// Canvas matches the lesson screen's 3D area on an iPhone 14 (390 × 460 pt, status bar included).
writeFileSync(
  join(dir, 'index.html'),
  `<html><body style="margin:0;background:#14161b"><canvas style="width:390px;height:460px;display:block"></canvas><script type="module" src="bundle.js"></script></body></html>`,
)

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--allow-file-access-from-files'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 460, deviceScaleFactor: 3 })
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto(`file://${join(dir, 'index.html')}?${query}`)
await page.waitForFunction('window.ready || window.error', { timeout: 60000 })
const error = await page.evaluate('window.error')
if (error) {
  console.error(error)
  process.exit(1)
}
await page.screenshot({ path: out })
console.log(`${out} (${await page.title()})`)
await browser.close()
