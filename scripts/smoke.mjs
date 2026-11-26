// DOM-смоук: прогоняет собранное приложение в jsdom против живого API
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
window.scrollTo = () => {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(text, timeout = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (window.document.body.textContent.includes(text)) return true
    await sleep(120)
  }
  throw new Error(`Не дождались текста: «${text}». Сейчас: ` + window.document.body.textContent.slice(0, 400))
}
function clickText(selector, text) {
  const els = [...window.document.querySelectorAll(selector)]
  const el = els.find((e) => e.textContent.trim().includes(text))
  if (!el) throw new Error(`Не найден элемент «${text}» среди ${selector} (${els.length})`)
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  return el
}
const errors = []
window.addEventListener('error', (e) => errors.push(e.message))

try {
  window.eval(bundle)
  await waitFor('Вход в кабинет')
  console.log('OK: страница входа отрисована')

  clickText('button', 'Войти в демо')
  await waitFor('Карта категорий')
  await waitFor('Мебельград')
  console.log('OK: дашборд с данными демо-кабинета')
  for (const t of ['Офисные кресла', 'Стеллажи и полки', 'Диваны', 'Активные гипотезы и тесты', 'Подтверждено', 'Провал', 'Последние действия']) {
    await waitFor(t)
  }
  console.log('OK: карта категорий, гипотезы, плитки результатов, лента действий')

  clickText('.nav-item', 'Категории')
  await waitFor('Досье каждой категории')
  await waitFor('Здесь выигрывает логистика')
  console.log('OK: список категорий с профилями')

  clickText('.tile', 'Стеллажи и полки')
  await waitFor('Бенчмарки')
  await waitFor('Срок доставки')
  console.log('OK: досье категории, бенчмарки')

  clickText('.tab', 'Паттерны')
  await waitFor('FBO с экспресс-доставкой')
  clickText('.tab', 'Карточки')
  await waitFor('Норма категории · медиана')
  await waitFor('Раскатан')
  clickText('.tab', 'События')
  await waitFor('экспресс расширил зоны')
  console.log('OK: паттерны, карточки против нормы, события')

  clickText('.nav-item', 'Гипотезы')
  await waitFor('Один связанный объект')
  clickText('.hyp-row', 'Обложка с ценой')
  await waitFor('Интерпретация')
  await waitFor('Откатить изменение')
  await waitFor('Масштабировать волнами')
  await waitFor('Контрольные метрики')
  console.log('OK: проваленная гипотеза — вердикт и два действия')

  window.history.back()
  await sleep(400)
  clickText('.nav-item', 'Гипотезы')
  await waitFor('Видеообзор 30 секунд')
  clickText('.hyp-row', 'Видеообзор 30 секунд')
  await waitFor('Набор мощности')
  await waitFor('Акция площадки')
  console.log('OK: идущий тест — прогресс мощности и предупреждения')

  window.history.back()
  await sleep(400)
  clickText('.nav-item', 'Гипотезы')
  await waitFor('Экспресс-доставка FBO')
  clickText('.hyp-row', 'Экспресс-доставка FBO')
  await waitFor('Раскатка волнами')
  await waitFor('Волна 3')
  await waitFor('Контрольная группа сохраняется')
  console.log('OK: подтверждённый результат — волны и контроль')

  clickText('.nav-item', 'Журнал')
  await waitFor('Журнал действий')
  await waitFor('Снизил ставку трафаретов')
  console.log('OK: журнал с действиями агента')

  clickText('.agent-btn', 'Действия')
  await waitFor('Свежие действия')
  console.log('OK: выдвижная панель действий')

  if (errors.length) { console.log('JS-ошибки:', errors.slice(0, 5)); process.exit(1) }
  console.log('\nСМОУК ПРОЙДЕН: все ключевые экраны живые.')
  process.exit(0)
} catch (e) {
  console.error('СМОУК ПРОВАЛЕН:', e.message)
  if (errors.length) console.error('JS-ошибки:', errors.slice(0, 5))
  process.exit(1)
}
