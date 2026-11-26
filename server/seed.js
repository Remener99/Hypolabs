import { db, q, uid, now, S } from './db.js'
import { requiredSample, binsFromQuantiles, rolloutSeries } from './stats.js'
import crypto from 'node:crypto'

const force = process.argv.includes('--force')
const hasUsers = q.get('SELECT COUNT(*) AS n FROM users').n > 0
if (hasUsers && !force) {
  console.log('База уже содержит данные — сид пропущен. Для пересоздания: npm run seed')
  process.exit(0)
}
if (force) {
  for (const t of ['sessions', 'actions', 'rollouts', 'interpretations', 'tests', 'hypotheses', 'daily', 'cards', 'events', 'patterns', 'benchmarks', 'categories', 'cabinets', 'users']) {
    db.exec(`DELETE FROM ${t}`)
  }
}

// ---------- helpers ----------
const DAY = 86400000
const base = new Date(); base.setHours(12, 0, 0, 0)
const iso = (daysAgo, h = 10, m = 0) => { const d = new Date(base.getTime() - daysAgo * DAY); d.setHours(h, m, 0, 0); return d.toISOString() }
const day = (daysAgo) => iso(daysAgo).slice(0, 10)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const rnd = mulberry32(20261126)
const hash = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); const h = crypto.scryptSync(pw, salt, 64).toString('hex'); return `${salt}:${h}` }

// ---------- user & cabinets ----------
const userId = uid()
q.run('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)', userId, 'demo@lemma.ru', 'Анна Соколова', hash('lemma2026'), iso(90))
const cab1 = uid(), cab2 = uid()
q.run('INSERT INTO cabinets (id,user_id,name,seller,marketplace,created_at) VALUES (?,?,?,?,?,?)', cab1, userId, 'Мебельград', 'ИП Соколов А. В.', 'WB · Ozon', iso(90))
q.run('INSERT INTO cabinets (id,user_id,name,seller,marketplace,created_at) VALUES (?,?,?,?,?,?)', cab2, userId, 'Гринвич · сад и декор', 'ООО Гринвич', 'Ozon', iso(30))

// ---------- categories ----------
const catCh = uid(), catSh = uid(), catSo = uid()
const insCat = (id, name, mp, icon, thesis, desc, profile, daysAgo) =>
  q.run('INSERT INTO categories (id,cabinet_id,name,marketplace,icon,description,thesis,profile,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, cab1, name, mp, icon, desc, thesis, S(profile), iso(daysAgo))
insCat(catCh, 'Офисные кресла', 'WB', 'chair', 'Здесь выигрывает контент', 'Кресла для дома и офиса, 12–18 тыс ₽. Решение о покупке принимается по галерее.', { content: 0.92, logistics: 0.34, price: 0.42, ads: 0.58, reviews: 0.66, season: 0.30 }, 88)
insCat(catSh, 'Стеллажи и полки', 'Ozon', 'shelf', 'Здесь выигрывает логистика', 'Объёмная мебель до 6 тыс ₽. Скорость доставки решает ранжирование.', { content: 0.35, logistics: 0.95, price: 0.60, ads: 0.44, reviews: 0.50, season: 0.52 }, 88)
insCat(catSo, 'Диваны', 'WB', 'sofa', 'Здесь выигрывают цена и отзывы', 'КГТ, 28–42 тыс ₽. Покупают по цене коридора и отзывам с фото.', { content: 0.50, logistics: 0.46, price: 0.92, ads: 0.68, reviews: 0.86, season: 0.62 }, 85)

// ---------- benchmarks ----------
const B = {}
function bench(key, cat, metric, unit, min, max, p10, p25, p50, p75, p90, leader, seller, hb, sample, method) {
  const id = uid(); B[key] = id
  q.run(`INSERT INTO benchmarks (id,category_id,metric,unit,min,max,p10,p25,p50,p75,p90,leader,seller,higher_better,bins,sample,period,source,method,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, cat, metric, unit, min, max, p10, p25, p50, p75, p90, leader, seller, hb,
    S(binsFromQuantiles(min, max, p25, p50, p75)), sample, '01.10–24.11.2026', 'Лемма · панель категории', method, iso(1, 9, 40))
}
const mPct = 'Перцентили по активным карточкам с ≥300 показов в день'
bench('ch_ctr', catCh, 'CTR карточки', '%', 1.5, 9, 3.1, 4.2, 5.1, 6.0, 6.9, 6.9, 3.9, 1, 2140, mPct)
bench('ch_conv', catCh, 'Конверсия в заказ', '%', 1, 7.5, 2.4, 3.4, 4.2, 5.1, 5.9, 5.9, 3.6, 1, 2140, mPct)
bench('ch_img', catCh, 'Изображений в карточке', 'шт', 2, 15, 4, 6, 8, 10, 12, 12, 5, 1, 2140, 'Подсчёт медиа в карточках топ-500')
bench('ch_price', catCh, 'Цена', '₽', 6000, 26000, 9200, 11800, 14600, 17900, 20800, 16900, 15400, 0, 2140, 'Медиана цен активных карточек')
bench('ch_rating', catCh, 'Рейтинг', '', 3.8, 5, 4.5, 4.7, 4.8, 4.9, 4.95, 4.95, 4.7, 1, 2140, 'Средневзвешенный рейтинг по отзывам')
bench('ch_reviews', catCh, 'Отзывы', 'шт', 10, 900, 35, 90, 210, 420, 640, 640, 96, 1, 2140, 'Распределение числа отзывов')
bench('sh_delivery', catSh, 'Срок доставки', 'дн', 0.5, 7, 0.9, 1.2, 1.8, 2.6, 3.4, 1.0, 1.4, 0, 1860, 'Медиана обещанного срока по регионам')
bench('sh_conv', catSh, 'Конверсия в заказ', '%', 1.5, 8, 2.8, 3.7, 4.6, 5.4, 6.2, 6.2, 4.8, 1, 1860, mPct)
bench('sh_ctr', catSh, 'CTR карточки', '%', 1.5, 8, 2.7, 3.5, 4.2, 5.0, 5.7, 5.7, 4.1, 1, 1860, mPct)
bench('sh_price', catSh, 'Цена', '₽', 1200, 9500, 2100, 2900, 4300, 5900, 7200, 5100, 4700, 0, 1860, 'Медиана цен активных карточек')
bench('sh_buyout', catSh, 'Выкуп', '%', 70, 99, 82, 88, 91, 94, 96, 96, 91, 1, 1860, 'Доля выкупленных заказов')
bench('sh_fbo', catSh, 'Доля продаж через FBO', '%', 0, 100, 40, 62, 78, 90, 97, 97, 86, 1, 1860, 'Доля заказов со склада площадки')
bench('so_price', catSo, 'Цена', '₽', 18000, 70000, 24200, 28400, 34800, 41200, 48600, 35900, 41900, 0, 940, 'Медиана цен активных карточек')
bench('so_conv', catSo, 'Конверсия в заказ', '%', 0.4, 4, 1.0, 1.4, 1.9, 2.5, 3.0, 3.0, 1.6, 1, 940, mPct)
bench('so_photo', catSo, 'Отзывы с фото', '%', 5, 90, 22, 38, 52, 64, 76, 76, 31, 1, 940, 'Доля отзывов с фото покупателя')
bench('so_rating', catSo, 'Рейтинг', '', 4.0, 5, 4.55, 4.7, 4.85, 4.92, 4.97, 4.97, 4.8, 1, 940, 'Средневзвешенный рейтинг по отзывам')
bench('so_drr', catSo, 'ДРР', '%', 3, 18, 4.6, 6.2, 8.5, 11, 13.5, 6.0, 11.2, 0, 940, 'Доля рекламных расходов в выручке')
bench('so_delivery', catSo, 'Срок доставки', 'дн', 2, 14, 3, 4, 6, 8, 11, 3.5, 7, 0, 940, 'Медиана обещанного срока КГТ')

// ---------- patterns ----------
const P = {}
function pat(key, cat, grp, title, prevalence, impact, detail, daysAgo = 20) {
  const id = uid(); P[key] = id
  q.run('INSERT INTO patterns (id,category_id,grp,title,detail,prevalence,impact,source,sample,period,method,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, cat, grp, title, detail, prevalence, impact, 'Лемма · разбор топ-50 категории', 50, 'окт–ноя 2026', 'Признак встречается у лидеров чаще, чем в остальной выборке (χ², p<0,05)', iso(daysAgo))
}
pat('ch_video', catCh, 'content', 'Видеообзор 20–40 сек в галерее', 82, 'решающий', 'Лидеры показывают кресло в движении: регулировки, сборка, посадка. Медианный прирост CTR +18%.', 12)
pat('ch_interior', catCh, 'content', '8+ изображений, съёмка в интерьере', 74, 'сильный', 'Первые два кадра — кресло в рабочем интерьере, дальше детали, регулировки и габариты.', 12)
pat('ch_infograf', catCh, 'content', 'Инфографика регулировок на 3–5 кадре', 61, 'умеренный', 'Схема поясничной поддержки и регулировок снимает возражения до отзыва.', 30)
pat('ch_ads', catCh, 'ads', 'Кластерные ставки в трафаретах', 68, 'сильный', 'Лидеры держат ДРР ≤9%: ставка по кластеру, автокампании только на поиск.', 30)
pat('ch_reviews', catCh, 'reviews', 'Ответ на отзыв за 24 часа', 71, 'умеренный', 'Скорость ответа коррелирует с долей отзывов 5★.', 40)
pat('ch_season', catCh, 'season', 'Пики: конец августа и январь', 64, 'умеренный', 'Спрос всплесками к учебному году и после праздников, летом спад −20%.', 40)
pat('sh_express', catSh, 'logistics', 'FBO с экспресс-доставкой ≤2 дней', 88, 'решающий', 'Скорость доставки — главный фактор ранжирования в объёмной мебели. Разрыв 1 день ≈ +9% заказов.', 8)
pat('sh_pack', catSh, 'logistics', 'Упаковка под габарит, бой <1%', 77, 'сильный', 'Двойной гофрокартон и уголки: возвраты по бою у лидеров в 3 раза ниже.', 8)
pat('sh_price', catSh, 'price', 'Коридор 2,9–5,9 тыс ₽', 72, 'сильный', 'Выход выше 6 тыс ₽ переводит карточку в сравнение с другой полкой.', 25)
pat('sh_scheme', catSh, 'content', 'Габаритная схема на 2 кадре', 58, 'умеренный', 'Контент вторичен: достаточно 5–6 кадров, схемы сборки и габаритов.', 25)
pat('sh_ads', catSh, 'ads', 'Трафареты только на поиске', 54, 'умеренный', 'Полочные показы дают клики без заказов: лидеры отключают полку.', 35)
pat('sh_season', catSh, 'season', 'Сентябрь и январь: +35–40% спроса', 69, 'сильный', 'Переезды и обновление хранения: запас на складах к сентябрю.', 35)
pat('so_corridor', catSo, 'price', 'Коридор 28–42 тыс ₽ и вход в акции', 84, 'решающий', 'Лидеры концентрируются в 31–36 тыс ₽ и участвуют в каждой акции площадки.', 6)
pat('so_photo', catSo, 'reviews', 'Отзывы с фото: ≥50% отзывов', 79, 'решающий', 'Фото реальных покупателей — главный аргумент для КГТ. Конверсия карточек с фотоотзывами ×1,6.', 6)
pat('so_installment', catSo, 'price', 'Рассрочка 0-0-6', 90, 'сильный', 'Рассрочка снимает барьер чека: у 90% лидеров подключена.', 20)
pat('so_ads', catSo, 'ads', 'Бустер + трафареты, ДРР ≤8%', 66, 'сильный', 'Лидеры разгоняют бустером новинки и держат ДРР в норме кластера.', 20)
pat('so_kgt', catSo, 'logistics', 'Собственная доставка КГТ ≤7 дней', 57, 'умеренный', 'Срок важен, но решает цена: лидеры везут своей службой за 5–7 дней.', 45)
pat('so_season', catSo, 'season', 'Октябрь–декабрь и май — пиковые окна', 73, 'сильный', 'Перед Новым годом спрос +45%: цену коридора держат до декабря.', 45)

// ---------- events ----------
function ev(cat, daysAgo, title, source, affected, note) {
  q.run('INSERT INTO events (id,category_id,date,title,source,affected,note,created_at) VALUES (?,?,?,?,?,?,?,?)',
    uid(), cat, day(daysAgo), title, source, affected, note, iso(daysAgo))
}
ev(catCh, 1, 'WB: акция «Чёрная пятница» 28.11–01.12', 'WB Партнёры', 1, 'Пересекается с тестом видеообложки: обе группы под одним эффектом, сравнение валидно.')
ev(catCh, 21, 'WB: видео в карточке повышает вес в ранжировании мебели', 'WB Партнёры', 1, 'Подтверждает гипотезу по видеообложке.')
ev(catCh, 45, 'WB: новые требования к фото 3:4', 'WB Партнёры', 0, 'Текущие фото соответствуют, изменений не требуется.')
ev(catSh, 12, 'Ozon: экспресс расширил зоны покрытия', 'Ozon Seller', 1, 'Усиливает эффект раскатки экспресс-доставки: +2 региона.')
ev(catSh, 18, 'Ozon: трафареты в мебели подорожали на 12%', 'Ozon Seller', 1, 'ДРР под контролем: 9,3% при норме до 11%.')
ev(catSh, 56, 'Ozon: новый формат рич-контента', 'Ozon Seller', 0, 'Для категории не критично: контент вторичен.')
ev(catSo, 8, 'WB: рассрочка 0-0-6 продлена до конца года', 'WB Партнёры', 1, 'Окно для входа в ценовой коридор без потери маржи.')
ev(catSo, 16, 'WB: тарифы КГТ на доставку +8%', 'WB Партнёры', 1, 'Маржа под давлением, цена выше коридора лидеров.')
ev(catSo, 4, 'Ozon: мебельный фестиваль 12–15.12, приём заявок', 'Ozon Seller', 0, 'Анонс; решение по участию до 05.12.')

// ---------- cards ----------
const C = { ch: [], sh: [], so: [] }
function card(key, cat, sku, name, price, metrics, status = 'active', daysAgo = 80) {
  const id = uid(); if (key) C[key].push(id)
  q.run('INSERT INTO cards (id,category_id,sku,name,price,status,metrics,created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, cat, sku, name, price, status, S(metrics), iso(daysAgo))
  return id
}
const M = (o) => Object.assign({ ctr: 4.0, conv: 3.8, orders: 30, rating: 4.7, reviews: 90, images: 5, video: 0, delivery: 2.5, buyout: 90, bid: 35, cover: 'photo', photo_reviews: 30 }, o)
card('ch', catCh, 'WB-71023411', 'Кресло ErgoLine Pro', 15900, M({ ctr: 4.6, conv: 3.9, orders: 52, rating: 4.8, reviews: 214, images: 6, delivery: 2.2, bid: 38 }))
card('ch', catCh, 'WB-71023412', 'Кресло ComfortSit 200', 14400, M({ ctr: 4.2, conv: 3.7, orders: 44, rating: 4.7, reviews: 156, images: 5, delivery: 2.4 }))
card('ch', catCh, 'WB-71023413', 'Кресло OfficeFlex Mesh', 12900, M({ ctr: 5.8, conv: 3.2, orders: 38, rating: 4.6, reviews: 88, images: 5, cover: 'price', delivery: 2.6 }))
card('ch', catCh, 'WB-71023414', 'Кресло ErgoLine Lite', 11400, M({ ctr: 3.4, conv: 3.4, orders: 31, rating: 4.7, reviews: 64, images: 4, delivery: 2.3 }))
card('ch', catCh, 'WB-71023415', 'Кресло ComfortSit Kids', 9900, M({ ctr: 3.1, conv: 3.0, orders: 22, rating: 4.8, reviews: 41, images: 4, delivery: 2.8 }))
card('ch', catCh, 'WB-71023416', 'Кресло OfficeFlex Leather', 17900, M({ ctr: 5.4, conv: 3.1, orders: 27, rating: 4.5, reviews: 73, images: 6, cover: 'price', delivery: 2.5 }))
card('ch', catCh, 'WB-71023417', 'Кресло AeroBack', 16400, M({ ctr: 3.6, conv: 3.5, orders: 18, rating: 4.7, reviews: 37, images: 5, delivery: 2.4 }))
const shNames = ['Стеллаж Лофт-1', 'Стеллаж Лофт-2', 'Стеллаж Лофт-3', 'Стеллаж Лофт-4', 'Стеллаж Лофт-5', 'Полка Настенная Сет', 'Стеллаж Куб 4×4', 'Стеллаж Индастриал', 'Полка Угловая Норд', 'Стеллаж Бамбук Мини', 'Стеллаж Модуль Про', 'Полка Парящая Дуб', 'Стеллаж Гараж Сталь', 'Стеллаж Детский Радуга', 'Стеллаж Офис Систем', 'Полка Книжная Узкая']
shNames.forEach((name, i) => {
  const rolled = i < 11
  const price = [4900, 4700, 5200, 4500, 5400, 2400, 5900, 6300, 2900, 3400, 6800, 3100, 7400, 4200, 6900, 2200][i]
  const orders = rolled ? 48 + Math.round(rnd() * 22) : 30 + Math.round(rnd() * 12)
  card('sh', catSh, `OZ-5510${2100 + i}`, name, price, M({
    ctr: +(3.8 + rnd() * 0.9).toFixed(1), conv: rolled ? +(4.9 + rnd() * 0.7).toFixed(1) : +(4.0 + rnd() * 0.4).toFixed(1),
    orders, rating: +(4.6 + rnd() * 0.3).toFixed(1), reviews: 40 + Math.round(rnd() * 220), images: 5 + (i % 2),
    delivery: rolled ? +(1.1 + rnd() * 0.5).toFixed(1) : +(2.8 + rnd() * 0.7).toFixed(1), buyout: 89 + Math.round(rnd() * 4), bid: 22 + Math.round(rnd() * 10)
  }), rolled ? 'rolled' : 'control')
})
const soData = [['Диван Сканди 3М', 42900, 14], ['Диван Лофт Прямой', 41900, 12], ['Диван Угловой Осло', 45900, 11], ['Диван Книжка Мини', 33900, 16], ['Диван Комфорт Плюс', 43900, 8], ['Диван Токио 2М', 38900, 9]]
soData.forEach(([name, price, orders], i) => {
  card('so', catSo, `WB-8804${1200 + i}`, name, price, M({
    ctr: +(2.6 + rnd() * 0.8).toFixed(1), conv: +(1.3 + rnd() * 0.6).toFixed(1), orders,
    rating: +(4.7 + rnd() * 0.2).toFixed(1), reviews: 30 + Math.round(rnd() * 90), images: 6 + (i % 3),
    delivery: 6 + Math.round(rnd() * 3), buyout: 86 + Math.round(rnd() * 5), bid: 60 + Math.round(rnd() * 25),
    photo_reviews: 22 + Math.round(rnd() * 20)
  }))
})

// ---------- hypotheses / tests / interpretations / rollouts ----------
const H = {}, T = {}, I = {}, R = {}
function hyp(key, cat, title, factKind, factRef, factText, stage, rub, priority, status, origin, cardIds, createdAgo, updatedAgo) {
  const id = uid(); H[key] = id
  q.run(`INSERT INTO hypotheses (id,cabinet_id,category_id,title,fact_kind,fact_ref,fact_text,funnel_stage,expected_rub,priority,status,origin,card_ids,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, cab1, cat, title, factKind, factRef, factText, stage, rub, priority, status, origin, S(cardIds), iso(createdAgo), iso(updatedAgo))
  return id
}
function test(key, hkey, metric, baseline, mde, startAgo, endAgo, status, current, warnings, planned) {
  const id = uid(); T[key] = id
  const { total } = requiredSample(baseline / 100, mde / 100)
  q.run(`INSERT INTO tests (id,hypothesis_id,metric,baseline,mde,alpha,power,required_n,current_n,start_date,end_date,status,warnings,planned,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, H[hkey], metric, baseline, mde, 0.05, 0.8, total, current,
    startAgo == null ? null : day(startAgo), endAgo == null ? null : day(endAgo), status, S(warnings), S(planned), iso(startAgo == null ? 5 : startAgo + 1))
  return id
}
function interp(key, tkey, verdict, summary, effects, controls, rub, decided, ago) {
  const id = uid(); I[key] = id
  q.run('INSERT INTO interpretations (id,test_id,verdict,summary,effects,controls,effect_rub,decided,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, T[tkey], verdict, summary, S(effects), S(controls), rub, decided, iso(ago))
}

// H1 — идущий тест (видеообложка, кресла)
hyp('video', catCh, 'Видеообзор 30 секунд вместо статичной обложки', 'benchmark', B.ch_ctr,
  'CTR 3,9% при норме 4,2–6,0%. У 82% лидеров категории есть видео в галерее, у нас — ни у одной карточки.',
  'Клик', 186000, 'high', 'testing', 'agent', [C.ch[0], C.ch[1]], 14, 8)
test('video', 'video', 'Конверсия в заказ', 3.6, 0.5, 8, -6, 'running', 38600,
  ['Акция площадки 28.11–01.12 попадает в окно теста: обе группы под одним эффектом, сравнение валидно, абсолютные значения завышены.',
   'Контроль: 2 карточки без видео, сопоставимы по цене и отзывам. Пересечений с раскаткой стеллажей нет.'],
  { delta: 0.5, ci: [0.1, 0.9], unit: 'п.п.', rub: 186000, verdict: 'confirmed', ctrDelta: 16 })

// H2 — подтверждённый результат, раскатан волнами (экспресс, стеллажи)
hyp('express', catSh, 'Экспресс-доставка FBO для топ-артикулов', 'benchmark', B.sh_delivery,
  '88% лидеров доставляют за ≤2 дня. Медиана категории 1,8 дня, у нас было 3,1 дня — разрыв стоил заказов.',
  'Заказ', 380000, 'high', 'scaled', 'agent', C.sh.slice(0, 11), 72, 31)
test('express', 'express', 'Конверсия в заказ', 4.1, 0.6, 65, 51, 'completed', 31240,
  ['Осенний всплеск спроса попадает в окно: контроль подвержен тому же эффекту.'], {})
interp('express', 'express', 'confirmed',
  'Заказы выросли на 14,2% при стабильных контрольных метриках. Эффект устойчив во всех трёх волнах раскатки.',
  [{ metric: 'Заказы', delta: 14.2, ci: [9.1, 19.3], unit: '%', primary: true },
   { metric: 'Конверсия в заказ', delta: 0.7, ci: [0.3, 1.1], unit: 'п.п.', primary: false }],
  [{ metric: 'CTR', before: 4.1, after: 4.2, unit: '%', ok: true },
   { metric: 'Выкуп', before: 91, after: 91, unit: '%', ok: true },
   { metric: 'ДРР', before: 9.1, after: 9.3, unit: '%', ok: true }],
  412000, 'scale', 50)
R.express = uid()
const waves = [
  { n: 1, date: day(45), card_ids: C.sh.slice(0, 3), status: 'done' },
  { n: 2, date: day(38), card_ids: C.sh.slice(3, 7), status: 'done' },
  { n: 3, date: day(31), card_ids: C.sh.slice(7, 11), status: 'done' }
]
q.run('INSERT INTO rollouts (id,hypothesis_id,status,control_ids,waves,series,created_at) VALUES (?,?,?,?,?,?,?)',
  R.express, H.express, 'done', S(C.sh.slice(11, 16)), S(waves), S(rolloutSeries(3, 14.2)), iso(50))

// H3 — проваленный тест (обложка с ценой, кресла), решение не принято
hyp('cover', catCh, 'Обложка с ценой и скидкой', 'benchmark', B.ch_ctr,
  'CTR ниже нормы. У 34% лидеров цена вынесена на обложку — казалась быстрой мерой.',
  'Клик', 140000, 'mid', 'interpreted', 'agent', [C.ch[2], C.ch[5]], 29, 8)
test('cover', 'cover', 'Заказы', 38, 6, 23, 9, 'completed', 24800,
  ['Тест шёл до акции площадки: загрязнений нет.'], {})
interp('cover', 'cover', 'failed',
  'CTR вырос на 22%, но заказы упали на 6%: обложка с ценой привлекает нецелевой трафик и отсекает клики по фото.',
  [{ metric: 'Заказы', delta: -6, ci: [-11, -1], unit: '%', primary: true },
   { metric: 'CTR', delta: 22, ci: [17, 27], unit: '%', primary: false }],
  [{ metric: 'Показы', before: 41200, after: 48600, unit: 'шт', ok: true },
   { metric: 'Добавления в корзину', before: 1730, after: 1880, unit: 'шт', ok: true },
   { metric: 'Выкуп', before: 90, after: 89, unit: '%', ok: true }],
  -96000, null, 8)

// H4 — новая гипотеза (ценовой коридор, диваны)
hyp('price', catSo, 'Вход в ценовой коридор 28–42 тыс ₽', 'benchmark', B.so_price,
  'Медиана наших диванов 41 900 ₽ — выше коридора лидеров 28 400–41 200 ₽. Лидеры концентрируются в 31–36 тыс ₽.',
  'Заказ', 318000, 'high', 'new', 'agent', [C.so[0], C.so[1], C.so[4]], 2, 2)

// H5 — принята, тест рассчитан но не запущен (отзывы с фото, диваны)
hyp('reviews', catSo, 'Отзывы с фото: программа вложений с QR', 'pattern', P.so_photo,
  'У 79% лидеров ≥50% отзывов с фото, у нас 31%. Конверсия карточек с фотоотзывами в категории ×1,6.',
  'Выкуп', 124000, 'mid', 'accepted', 'user', [C.so[3], C.so[5]], 6, 5)
test('reviews', 'reviews', 'Конверсия в заказ', 1.6, 0.4, null, null, 'draft', 0,
  ['Эффект отложенный: отзывы накапливаются 2–3 недели, поэтому окно теста 21 день.'],
  { delta: 0.4, ci: [0.05, 0.75], unit: 'п.п.', rub: 124000, verdict: 'confirmed', ctrDelta: 2 })

// ---------- daily metrics (60 дней) ----------
for (let i = 59; i >= 0; i--) {
  const d = new Date(base.getTime() - i * DAY)
  const dow = d.getDay()
  const weekend = (dow === 0 || dow === 6) ? 1.12 : 1
  const trend = 1 + (59 - i) * 0.0035
  const noise = 0.94 + rnd() * 0.12
  const revenue = Math.round(302000 * weekend * trend * noise)
  const orders = Math.round(revenue / (8900 + rnd() * 700))
  const conv = +(3.7 + rnd() * 0.45).toFixed(2)
  const sessions = Math.round(orders / (conv / 100))
  q.run('INSERT INTO daily (cabinet_id,date,revenue,orders,sessions,conv,ad_share) VALUES (?,?,?,?,?,?,?)',
    cab1, day(i), revenue, orders, sessions, conv, +(9.2 + rnd() * 1.6).toFixed(1))
}

// ---------- agent / user actions ----------
function act(daysAgo, h, m, actor, type, title, target, payload, note, provenance) {
  q.run('INSERT INTO actions (id,cabinet_id,actor,type,title,note,target,payload,provenance,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    uid(), cab1, actor, type, title, note || null, S(target || {}), payload ? S(payload) : null, provenance ? S(provenance) : null, iso(daysAgo, h, m))
}
act(0, 9, 40, 'agent', 'benchmark', 'Обновил бенчмарк CTR по креслам', { entity: 'benchmark', id: B.ch_ctr, category_id: catCh },
  { kind: 'benchmark', id: B.ch_ctr, before: { seller: 4.1 }, after: { seller: 3.9 } },
  'Пересчёт по свежей панели: CTR кабинета снизился после акции конкурентов.',
  { source: 'Панель WB', sample: '2 140 карточек', period: '01.10–24.11', method: 'Перцентили по активным карточкам' })
act(0, 8, 15, 'agent', 'bid', 'Снизил ставку трафаретов: ErgoLine Pro', { entity: 'card', id: C.ch[0], category_id: catCh },
  { kind: 'card', id: C.ch[0], field: 'bid', before: 42, after: 38 },
  'ДРР артикула 10,4% — выше нормы кластера. Ставка 42 → 38 ₽.',
  { source: 'Кабинет WB Ads', sample: '7 дней показов', period: '19–25.11', method: 'Норма ставки по кластеру категории' })
act(1, 17, 2, 'agent', 'card_edit', 'Добавил габаритную схему: Стеллаж Лофт-3', { entity: 'card', id: C.sh[2], category_id: catSh },
  { kind: 'card', id: C.sh[2], field: 'images', before: 5, after: 6 },
  'Паттерн категории: габаритная схема на 2 кадре у 58% лидеров.')
act(2, 16, 45, 'agent', 'hypothesis', 'Создал гипотезу: ценовой коридор диванов', { entity: 'hypothesis', id: H.price, category_id: catSo },
  { kind: 'hypothesis', id: H.price },
  'Разрыв с бенчмарком цены: 41 900 ₽ против коридора 28 400–41 200 ₽.',
  { source: 'Бенчмарк цены категории', sample: '940 карточек', period: '01.10–24.11', method: 'Оценка эффекта по эластичности категории' })
act(3, 10, 5, 'agent', 'price', 'Цена: Диван Сканди 44 900 → 42 900 ₽', { entity: 'card', id: C.so[0], category_id: catSo },
  { kind: 'card', id: C.so[0], field: 'price', before: 44900, after: 42900 },
  'Проба входа в коридор перед гипотезой. Маржа сохранена за счёт рассрочки.')
act(5, 9, 0, 'user', 'accept', 'Приняла гипотезу: отзывы с фото', { entity: 'hypothesis', id: H.reviews, category_id: catSo }, null, 'Тест рассчитан, запуск после накопления вложений.')
act(8, 9, 10, 'agent', 'test_start', 'Запустил тест видеообложки', { entity: 'test', id: T.video, hypothesis_id: H.video, category_id: catCh },
  { kind: 'test_start', id: T.video },
  'Мощность 80%, окно 14 дней, контроль — 2 сопоставимые карточки.')
act(8, 12, 20, 'agent', 'interpretation', 'Интерпретация: обложка с ценой — провал', { entity: 'hypothesis', id: H.cover, category_id: catCh }, null,
  'CTR +22%, заказы −6%. Рекомендация: откатить обложки.',
  { source: 'A/B тест, 24 800 наблюдений', sample: '2 карточки + 2 контроль', period: '03–17.11', method: 'Двухдолевой z-тест, 95% ДИ' })
act(23, 9, 0, 'agent', 'card_edit', 'Обложка с ценой: OfficeFlex Mesh', { entity: 'card', id: C.ch[2], category_id: catCh },
  { kind: 'card', id: C.ch[2], field: 'cover', before: 'photo', after: 'price' }, 'Изменение в рамках теста обложки.')
act(23, 9, 2, 'agent', 'card_edit', 'Обложка с ценой: OfficeFlex Leather', { entity: 'card', id: C.ch[5], category_id: catCh },
  { kind: 'card', id: C.ch[5], field: 'cover', before: 'photo', after: 'price' }, 'Изменение в рамках теста обложки.')
act(31, 10, 0, 'agent', 'wave', 'Раскатка экспресса: волна 3, 4 артикула', { entity: 'rollout', id: R.express, hypothesis_id: H.express, category_id: catSh },
  { kind: 'wave', id: R.express, n: 3 }, 'Эффект волны 2 подтверждён, контроль чистый.')
act(38, 10, 0, 'agent', 'wave', 'Раскатка экспресса: волна 2, 4 артикула', { entity: 'rollout', id: R.express, hypothesis_id: H.express, category_id: catSh },
  { kind: 'wave', id: R.express, n: 2 }, 'Волна 1 держит эффект +12%.')
act(45, 10, 0, 'agent', 'wave', 'Раскатка экспресса: волна 1, 3 артикула', { entity: 'rollout', id: R.express, hypothesis_id: H.express, category_id: catSh },
  { kind: 'wave', id: R.express, n: 1 }, 'Первая волна на самых похожих артикулах.')
act(50, 11, 30, 'user', 'decide', 'Масштабирую экспресс-доставку: 3 волны', { entity: 'hypothesis', id: H.express, category_id: catSh }, null, 'Контрольная группа: 5 артикулов, сохраняется до конца раскатки.')

console.log('Сид загружен: демо-кабинет «Мебельград», 3 категории, 29 артикулов, 5 гипотез.')
console.log('Вход: demo@lemma.ru / lemma2026')
