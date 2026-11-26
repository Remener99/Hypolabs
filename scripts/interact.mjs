import { JSDOM } from 'jsdom'
import fs from 'node:fs'
import path from 'node:path'
const dist = path.resolve('dist')
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const bundleFile = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.startsWith('index-') && f.endsWith('.js'))
const bundle = fs.readFileSync(path.join(dist, 'assets', bundleFile), 'utf8')
const dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true, runScripts: 'outside-only' })
const { window } = dom
window.fetch = (url, opts) => fetch(new URL(url, 'http://localhost:3000/'), opts)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(text, timeout = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (window.document.body.textContent.includes(text)) return true
    await sleep(120)
  }
  throw new Error(`Не дождались: «${text}». Текст: ` + window.document.body.textContent.slice(0, 300))
}
function clickText(selector, text, root = window.document) {
  const el = [...root.querySelectorAll(selector)].find((e) => e.textContent.trim().includes(text))
  if (!el) throw new Error(`Не найден «${text}» среди ${selector}`)
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  return el
}
window.eval(bundle)
await waitFor('Вход в кабинет')
clickText('button', 'Войти в демо')
await waitFor('Карта категорий')
// Журнал → откат первого действия с подтверждением
clickText('.nav-item', 'Журнал')
await waitFor('Все авторы')
await sleep(400)
await waitFor('Снизил ставку трафаретов')
const undoBtn = [...window.document.querySelectorAll('.act-item .btn')].find((b) => b.textContent.includes('Откатить'))
undoBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
await waitFor('Откатить изменение?')
const modal = window.document.querySelector('.modal')
clickText('.modal-foot .btn', 'Откатить', modal)
await waitFor('Изменение откачено')
await waitFor('откатано')
console.log('OK: откат действия через подтверждение, запись в журнале, оптимистичный бейдж')
// Переключение кабинета → пустые состояния
clickText('.cab-btn', 'Мебельград')
await sleep(300)
clickText('.cab-menu-item', 'Гринвич')
await sleep(300)
clickText('.nav-item', 'Дашборд')
await waitFor('Начните с категории')
console.log('OK: переключатель кабинетов, пустое состояние дашборда')
clickText('.nav-item', 'Категории')
await waitFor('Категорий пока нет')
clickText('.nav-item', 'Гипотезы')
await waitFor('Гипотез пока нет')
console.log('OK: пустые состояния разделов')
// Создание категории в пустом кабинете (CRUD из UI)
clickText('.nav-item', 'Категории')
await waitFor('Категорий пока нет')
clickText('.page-head .btn', 'Новая категория')
await sleep(300)
await waitFor('Что решает в категории')
const nameInput = window.document.querySelector('.modal .input')
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
setter.call(nameInput, 'Садовые качели')
nameInput.dispatchEvent(new window.Event('input', { bubbles: true }))
await sleep(150)
clickText('.modal-foot .btn', 'Создать')
await waitFor('Категория создана')
await waitFor('Садовые качели')
console.log('OK: создание категории из UI, тост, карточка в списке')
console.log('\nИНТЕРАКТИВ ПРОЙДЕН.')
process.exit(0)
