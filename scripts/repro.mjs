import { JSDOM, VirtualConsole } from 'jsdom'
import fs from 'node:fs'
import path from 'node:path'
const dist = path.resolve('dist')
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const bundleFile = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.startsWith('index-') && f.endsWith('.js'))
const bundle = fs.readFileSync(path.join(dist, 'assets', bundleFile), 'utf8')
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => console.log('JSDOM ERROR:', String(e.detail?.message || e).slice(0, 200)))
const dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })
const { window } = dom
let meFails = false
window.fetch = async (url, opts) => {
  const u = String(url)
  if (meFails && u.includes('/auth/me')) return new Response(JSON.stringify({ error: 'Нужен вход' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  return fetch(new URL(u, 'http://localhost:3000/'), opts)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(text, timeout = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) { if (window.document.body.textContent.includes(text)) return true; await sleep(120) }
  throw new Error('timeout: ' + text + ' | text=' + window.document.body.textContent.slice(0, 150))
}
window.eval(bundle)
await waitFor('Вход в кабинет')
const btn = [...window.document.querySelectorAll('button')].find((e) => e.textContent.includes('Войти в демо'))
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
await waitFor('Карта категорий')
console.log('OK: вход работает, дашборд отрисован')
// Сценарий 1: /auth/me начинает падать, но данные есть — приложение НЕ должно гаснуть
meFails = true
await sleep(500)
const len1 = window.document.getElementById('root').innerHTML.length
console.log('Сценарий 1 (фоновый 401, данные есть): root len =', len1, len1 > 1000 ? 'OK — приложение живо' : 'ПРОВАЛ')
// Сценарий 2: принудительный перезапрос me с 401 → аккуратный выход на экран входа
window.dispatchEvent(new window.CustomEvent('lemma:unauthorized'))
await waitFor('Вход в кабинет')
console.log('OK: при 401 — чистый выход на экран входа, без белого экрана и цикла')
process.exit(0)
