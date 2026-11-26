import { JSDOM, VirtualConsole } from 'jsdom'
import fs from 'node:fs'
import path from 'node:path'
const dist = path.resolve('dist')
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const bundleFile = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.startsWith('index-') && f.endsWith('.js'))
const bundle = fs.readFileSync(path.join(dist, 'assets', bundleFile), 'utf8')
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => console.log('JSDOM ERROR:', String(e.detail?.stack || e).slice(0, 1200)))
vc.on('error', (...a) => console.log('CONSOLE.ERROR:', ...a.map(x => String(x?.stack || x).slice(0, 800))))
const dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })
const { window } = dom
window.fetch = (url, opts) => fetch(new URL(url, 'http://localhost:3000/'), opts)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  window.eval('"use strict";\n' + bundle)
} catch (e) { console.log('EVAL THREW:', e.stack?.slice(0, 1200)) }
await sleep(1200)
console.log('ROOT LEN:', window.document.getElementById('root').innerHTML.length)
console.log('TEXT:', window.document.body.textContent.slice(0, 200))
// логин
const btn = [...window.document.querySelectorAll('button')].find((e) => e.textContent.includes('Войти в демо'))
if (btn) {
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(2500)
  console.log('AFTER LOGIN ROOT LEN:', window.document.getElementById('root').innerHTML.length)
  console.log('AFTER LOGIN TEXT:', window.document.body.textContent.slice(0, 300))
}
process.exit(0)
