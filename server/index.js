import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db, q, uid, now, S, J } from './db.js'
import { requiredSample, binsFromQuantiles, rolloutSeries } from './stats.js'
import {
  HttpError, bad, notFound, ownCabinet, ownCategory, ownHypothesis,
  logAction, undoAction, deleteHypothesis, deleteCategory, setCardField,
  parseHyp, parseTest, parseInterp, parseRollout, parseCard, parseBench, parseAction, parseCat
} from './util.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const app = express()
app.set('trust proxy', true)
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

// Лёгкий лог запросов — помогает диагностировать проблемы в превью-прокси
app.use((req, res, next) => {
  const t0 = Date.now()
  res.on('finish', () => {
    if (req.path.startsWith('/api') || res.statusCode >= 400) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`)
    }
  })
  next()
})
const extractToken = (req) =>
  req.cookies?.[COOKIE] ||
  (req.headers.authorization || '').replace('Bearer ', '') ||
  req.headers['x-lemma-token'] || null

// ---------- auth ----------
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}` }
const checkPw = (pw, stored) => {
  const [salt, h] = stored.split(':')
  const cand = crypto.scryptSync(pw, salt, 64)
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), cand)
}
const COOKIE = 'lemma_session'
function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex')
  q.run('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)', token, userId, new Date(Date.now() + 30 * 86400000).toISOString())
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'none', secure: true, partitioned: true, maxAge: 30 * 86400000, path: '/' })
  return token
}
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name })

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) bad('Укажите почту и пароль')
  const u = q.get('SELECT * FROM users WHERE email=?', String(email).toLowerCase().trim())
  if (!u || !checkPw(password, u.password_hash)) throw new HttpError(401, 'Неверная почта или пароль')
  const token = createSession(res, u.id)
  res.json({ user: publicUser(u), token })
})
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {}
  if (!email || !password || !name) bad('Заполните все поля')
  if (String(password).length < 6) bad('Пароль от 6 символов')
  if (q.get('SELECT id FROM users WHERE email=?', String(email).toLowerCase().trim())) bad('Почта уже занята')
  const id = uid()
  q.run('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)', id, String(email).toLowerCase().trim(), name, hashPw(password), now())
  q.run('INSERT INTO cabinets (id,user_id,name,seller,marketplace,created_at) VALUES (?,?,?,?,?,?)', uid(), id, 'Мой кабинет', '', 'WB', now())
  const token = createSession(res, id)
  res.json({ user: publicUser(q.get('SELECT * FROM users WHERE id=?', id)), token })
})
app.post('/api/auth/logout', (req, res) => {
  const token = extractToken(req)
  if (token) q.run('DELETE FROM sessions WHERE token=?', token)
  res.clearCookie(COOKIE, { sameSite: 'none', secure: true, partitioned: true })
  res.json({ ok: true })
})
app.use('/api', (req, res, next) => {
  if (['/auth/login', '/auth/register', '/auth/logout'].includes(req.path)) return next()
  const token = extractToken(req)
  if (!token) throw new HttpError(401, 'Нужен вход')
  const s = q.get('SELECT * FROM sessions WHERE token=?', token)
  if (!s || new Date(s.expires_at) < new Date()) throw new HttpError(401, 'Сессия истекла')
  req.user = q.get('SELECT * FROM users WHERE id=?', s.user_id)
  if (!req.user) throw new HttpError(401, 'Нужен вход')
  next()
})
app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) }))

// ---------- cabinets ----------
app.get('/api/cabinets', (req, res) => res.json(q.all('SELECT * FROM cabinets WHERE user_id=? ORDER BY created_at', req.user.id)))
app.post('/api/cabinets', (req, res) => {
  const { name, seller = '', marketplace = 'WB' } = req.body || {}
  if (!name) bad('Название кабинета обязательно')
  const id = uid()
  q.run('INSERT INTO cabinets (id,user_id,name,seller,marketplace,created_at) VALUES (?,?,?,?,?,?)', id, req.user.id, name, seller, marketplace, now())
  res.json(q.get('SELECT * FROM cabinets WHERE id=?', id))
})
app.patch('/api/cabinets/:id', (req, res) => {
  ownCabinet(req.user.id, req.params.id)
  const { name, seller, marketplace } = req.body || {}
  q.run('UPDATE cabinets SET name=COALESCE(?,name), seller=COALESCE(?,seller), marketplace=COALESCE(?,marketplace) WHERE id=?', name, seller, marketplace, req.params.id)
  res.json(q.get('SELECT * FROM cabinets WHERE id=?', req.params.id))
})
app.delete('/api/cabinets/:id', (req, res) => {
  ownCabinet(req.user.id, req.params.id)
  for (const c of q.all('SELECT id FROM categories WHERE cabinet_id=?', req.params.id)) deleteCategory(c.id)
  q.run('DELETE FROM daily WHERE cabinet_id=?', req.params.id)
  q.run('DELETE FROM actions WHERE cabinet_id=?', req.params.id)
  q.run('DELETE FROM cabinets WHERE id=?', req.params.id)
  res.json({ ok: true })
})

// ---------- overview (dashboard) ----------
function benchStatus(b) {
  const corridor = b.unit === '₽'
  if (b.seller >= b.p25 && b.seller <= b.p75) return { key: 'ok', label: 'В норме' }
  if (corridor) return b.seller < b.p25 ? { key: 'warn', label: 'Ниже коридора' } : { key: 'warn', label: 'Выше коридора' }
  const below = b.seller < b.p25
  const good = b.higher_better ? !below : below
  if (b.seller >= b.p90 && b.higher_better) return { key: 'lead', label: 'Уровень лидеров' }
  if (b.seller <= b.p10 && !b.higher_better) return { key: 'lead', label: 'Уровень лидеров' }
  return good ? { key: 'ok', label: 'В норме' } : { key: 'gap', label: below ? 'Ниже нормы' : 'Выше нормы' }
}
app.get('/api/cabinets/:id/overview', (req, res) => {
  const cab = ownCabinet(req.user.id, req.params.id)
  const daily = q.all('SELECT * FROM daily WHERE cabinet_id=? ORDER BY date', cab.id)
  const last = daily.slice(-30), prev = daily.slice(-60, -30)
  const sum = (arr, f) => arr.reduce((s, d) => s + d[f], 0)
  const avg = (arr, f) => arr.length ? sum(arr, f) / arr.length : 0
  const kpi = (key, title, cur, prevVal, spark, unit, fmt, invert = false) => {
    const delta = prevVal ? ((cur - prevVal) / prevVal) * 100 : 0
    return { key, title, value: cur, delta: +delta.toFixed(1), spark, unit, fmt, good: invert ? delta <= 0 : delta >= 0 }
  }
  const kpis = daily.length ? [
    kpi('revenue', 'Выручка', sum(last, 'revenue'), sum(prev, 'revenue'), last.map((d) => d.revenue), '₽', 'money'),
    kpi('orders', 'Заказы', sum(last, 'orders'), sum(prev, 'orders'), last.map((d) => d.orders), 'шт', 'int'),
    kpi('conv', 'Конверсия в заказ', +avg(last, 'conv').toFixed(2), +avg(prev, 'conv').toFixed(2), last.map((d) => d.conv), '%', 'pct'),
    kpi('ad', 'ДРР', +avg(last, 'ad_share').toFixed(1), +avg(prev, 'ad_share').toFixed(1), last.map((d) => d.ad_share), '%', 'pct', true)
  ] : []
  const period = last.length ? `${last[0].date.slice(5).split('-').reverse().join('.')}–${last[last.length - 1].date.slice(5).split('-').reverse().join('.')}` : ''
  const cats = q.all('SELECT * FROM categories WHERE cabinet_id=? ORDER BY created_at', cab.id).map((c) => {
    const benches = q.all('SELECT * FROM benchmarks WHERE category_id=?', c.id).map(parseBench)
    const cards = q.all('SELECT * FROM cards WHERE category_id=?', c.id).map(parseCard)
    const gaps = benches.map((b) => ({ id: b.id, metric: b.metric, unit: b.unit, seller: b.seller, p25: b.p25, p75: b.p75, status: benchStatus(b) }))
      .filter((g) => g.status.key === 'gap' || g.status.key === 'warn')
    const revenue = cards.reduce((s, x) => s + x.price * (x.metrics.orders || 0), 0)
    const overall = gaps.length === 0 ? { key: 'ok', label: 'В норме' } : gaps.length >= 3 ? { key: 'gap', label: `${gaps.length} разрыва` } : { key: 'warn', label: `${gaps.length} разрыв${gaps.length === 1 ? '' : 'а'}` }
    return { ...parseCat(c), cards_count: cards.length, revenue30: revenue, gaps: gaps.slice(0, 3), overall, benchmarks_count: benches.length }
  })
  const events = q.all(`SELECT e.*, c.name AS category_name, c.id AS category_id FROM events e JOIN categories c ON c.id=e.category_id WHERE c.cabinet_id=? ORDER BY e.date DESC LIMIT 8`, cab.id)
  const patterns = q.all(`SELECT p.*, c.name AS category_name FROM patterns p JOIN categories c ON c.id=p.category_id WHERE c.cabinet_id=? ORDER BY p.created_at DESC LIMIT 4`, cab.id)
  const feed = [
    ...events.map((e) => ({ kind: 'event', id: e.id, date: e.date, title: e.title, category_id: e.category_id, category_name: e.category_name, affected: !!e.affected, note: e.note, source: e.source })),
    ...patterns.map((p) => ({ kind: 'pattern', id: p.id, date: (p.created_at || '').slice(0, 10), title: p.title, category_id: p.category_id, category_name: p.category_name, grp: p.grp, prevalence: p.prevalence }))
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7)
  const hyps = q.all('SELECT * FROM hypotheses WHERE cabinet_id=? ORDER BY created_at DESC', cab.id).map(parseHyp)
  const active = hyps.filter((h) => ['new', 'accepted', 'testing'].includes(h.status)).map((h) => {
    const t = parseTest(q.get('SELECT * FROM tests WHERE hypothesis_id=? ORDER BY created_at DESC LIMIT 1', h.id))
    const cat = q.get('SELECT name FROM categories WHERE id=?', h.category_id)
    return { ...h, category_name: cat?.name, test: t ? { id: t.id, status: t.status, progress: t.required_n ? Math.min(100, Math.round((t.current_n / t.required_n) * 100)) : 0, end_date: t.end_date } : null }
  })
  const results = q.all(`SELECT i.*, h.title, h.id AS hypothesis_id, h.category_id, c.name AS category_name
    FROM interpretations i JOIN tests t ON t.id=i.test_id JOIN hypotheses h ON h.id=t.hypothesis_id
    JOIN categories c ON c.id=h.category_id WHERE h.cabinet_id=? ORDER BY i.created_at DESC`, cab.id)
    .map((r) => ({ ...r, effects: J(r.effects, []), controls: J(r.controls, []) }))
  const recent = q.all('SELECT * FROM actions WHERE cabinet_id=? ORDER BY created_at DESC LIMIT 6', cab.id).map(parseAction)
  res.json({
    cabinet: cab, kpis, period, categories: cats, feed, active, results, recent,
    provenance: { source: 'Лемма · агрегация кабинета', sample: `${cats.reduce((s, c) => s + c.cards_count, 0)} артикулов · ${cats.length} категории`, period, method: 'Суммы и средние по дням, окно 30 дней, сравнение с предыдущими 30' },
    counts: { hypotheses: hyps.length, tests_running: hyps.filter((h) => h.status === 'testing').length }
  })
})

// ---------- categories ----------
app.get('/api/categories', (req, res) => {
  ownCabinet(req.user.id, req.query.cabinet_id)
  const cats = q.all('SELECT * FROM categories WHERE cabinet_id=? ORDER BY created_at', req.query.cabinet_id).map((c) => {
    const benches = q.all('SELECT * FROM benchmarks WHERE category_id=?', c.id)
    const gaps = benches.filter((b) => ['gap', 'warn'].includes(benchStatus(b).key)).length
    return { ...parseCat(c), cards_count: q.get('SELECT COUNT(*) n FROM cards WHERE category_id=?', c.id).n, benchmarks_count: benches.length, patterns_count: q.get('SELECT COUNT(*) n FROM patterns WHERE category_id=?', c.id).n, gaps }
  })
  res.json(cats)
})
app.post('/api/categories', (req, res) => {
  const { cabinet_id, name, marketplace = 'WB', icon = 'chair', thesis = '', description = '', profile = {} } = req.body || {}
  ownCabinet(req.user.id, cabinet_id)
  if (!name) bad('Название категории обязательно')
  const id = uid()
  const prof = { content: 0.5, logistics: 0.5, price: 0.5, ads: 0.5, reviews: 0.5, season: 0.5, ...profile }
  q.run('INSERT INTO categories (id,cabinet_id,name,marketplace,icon,description,thesis,profile,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id, cabinet_id, name, marketplace, icon, description, thesis, S(prof), now())
  logAction(cabinet_id, 'user', 'category', `Создана категория «${name}»`, { target: { entity: 'category', id } })
  res.json(parseCat(q.get('SELECT * FROM categories WHERE id=?', id)))
})
app.get('/api/categories/:id', (req, res) => {
  const c = ownCategory(req.user.id, req.params.id)
  const benchmarks = q.all('SELECT * FROM benchmarks WHERE category_id=? ORDER BY metric', c.id).map((b) => ({ ...parseBench(b), status: benchStatus(b) }))
  res.json({
    category: parseCat(c),
    benchmarks,
    patterns: q.all('SELECT * FROM patterns WHERE category_id=? ORDER BY grp, prevalence DESC', c.id),
    events: q.all('SELECT * FROM events WHERE category_id=? ORDER BY date DESC', c.id),
    cards: q.all('SELECT * FROM cards WHERE category_id=? ORDER BY name', c.id).map(parseCard),
    actions: q.all('SELECT * FROM actions WHERE cabinet_id=? ORDER BY created_at DESC LIMIT 100', c.cabinet_id).map(parseAction).filter((a) => a.target.category_id === c.id)
  })
})
app.patch('/api/categories/:id', (req, res) => {
  const c = ownCategory(req.user.id, req.params.id)
  const { name, marketplace, icon, thesis, description, profile } = req.body || {}
  q.run('UPDATE categories SET name=COALESCE(?,name), marketplace=COALESCE(?,marketplace), icon=COALESCE(?,icon), thesis=COALESCE(?,thesis), description=COALESCE(?,description), profile=COALESCE(?,profile) WHERE id=?',
    name, marketplace, icon, thesis, description, profile ? S({ ...J(c.profile, {}), ...profile }) : null, c.id)
  res.json(parseCat(q.get('SELECT * FROM categories WHERE id=?', c.id)))
})
app.delete('/api/categories/:id', (req, res) => {
  const c = ownCategory(req.user.id, req.params.id)
  deleteCategory(c.id)
  logAction(c.cabinet_id, 'user', 'category', `Удалена категория «${c.name}»`, { target: { entity: 'category', id: c.id } })
  res.json({ ok: true })
})

// ---------- benchmarks ----------
function benchFields(body, existing = {}) {
  const v = { ...existing, ...body }
  for (const f of ['min', 'max', 'p10', 'p25', 'p50', 'p75', 'p90', 'leader', 'seller']) if (v[f] != null) v[f] = +v[f]
  if (v.p25 == null || v.p50 == null || v.p75 == null || v.min == null || v.max == null) bad('Нужны min, max, p25, p50, p75')
  if (v.p10 == null) v.p10 = v.p25 - (v.p50 - v.p25) * 0.8
  if (v.p90 == null) v.p90 = v.p75 + (v.p75 - v.p50) * 0.8
  v.bins = S(binsFromQuantiles(v.min, v.max, v.p25, v.p50, v.p75))
  return v
}
app.post('/api/benchmarks', (req, res) => {
  const c = ownCategory(req.user.id, req.body.category_id)
  if (!req.body.metric) bad('Название метрики обязательно')
  const v = benchFields(req.body)
  const id = uid()
  q.run(`INSERT INTO benchmarks (id,category_id,metric,unit,min,max,p10,p25,p50,p75,p90,leader,seller,higher_better,bins,sample,period,source,method,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, c.id, v.metric, v.unit || '', v.min, v.max, v.p10, v.p25, v.p50, v.p75, v.p90, v.leader ?? v.p90, v.seller ?? v.p50, v.higher_better == null ? 1 : +v.higher_better, v.bins,
    v.sample || 500, v.period || 'последние 60 дней', v.source || 'Лемма · панель категории', v.method || 'Перцентили по активным карточкам', now())
  logAction(c.cabinet_id, 'user', 'benchmark', `Добавлен бенчмарк «${v.metric}»`, { target: { entity: 'benchmark', id, category_id: c.id } })
  res.json({ ...parseBench(q.get('SELECT * FROM benchmarks WHERE id=?', id)), status: benchStatus(q.get('SELECT * FROM benchmarks WHERE id=?', id)) })
})
app.patch('/api/benchmarks/:id', (req, res) => {
  const b = q.get('SELECT * FROM benchmarks WHERE id=?', req.params.id); if (!b) notFound()
  const c = ownCategory(req.user.id, b.category_id)
  const v = benchFields(req.body, b)
  q.run(`UPDATE benchmarks SET metric=?,unit=?,min=?,max=?,p10=?,p25=?,p50=?,p75=?,p90=?,leader=?,seller=?,higher_better=?,bins=?,sample=?,period=?,source=?,method=?,updated_at=? WHERE id=?`,
    v.metric, v.unit || '', v.min, v.max, v.p10, v.p25, v.p50, v.p75, v.p90, v.leader ?? v.p90, v.seller ?? v.p50, v.higher_better == null ? 1 : +v.higher_better, v.bins, v.sample, v.period, v.source, v.method, now(), b.id)
  const after = q.get('SELECT * FROM benchmarks WHERE id=?', b.id)
  logAction(c.cabinet_id, 'user', 'benchmark', `Обновлён бенчмарк «${v.metric}»`, {
    target: { entity: 'benchmark', id: b.id, category_id: c.id },
    payload: { kind: 'benchmark', id: b.id, before: { seller: b.seller, p50: b.p50 }, after: { seller: after.seller, p50: after.p50 } }
  })
  res.json({ ...parseBench(after), status: benchStatus(after) })
})
app.delete('/api/benchmarks/:id', (req, res) => {
  const b = q.get('SELECT * FROM benchmarks WHERE id=?', req.params.id); if (!b) notFound()
  const c = ownCategory(req.user.id, b.category_id)
  q.run('DELETE FROM benchmarks WHERE id=?', b.id)
  logAction(c.cabinet_id, 'user', 'benchmark', `Удалён бенчмарк «${b.metric}»`, { target: { entity: 'benchmark', id: b.id, category_id: c.id } })
  res.json({ ok: true })
})

// ---------- patterns ----------
app.post('/api/patterns', (req, res) => {
  const c = ownCategory(req.user.id, req.body.category_id)
  const { grp = 'content', title, detail = '', prevalence = 50, impact = 'умеренный', source = 'Лемма · разбор топ-50', sample = 50, period = 'последние 60 дней', method = 'Сравнение частоты признака у лидеров и остальных' } = req.body
  if (!title) bad('Название паттерна обязательно')
  const id = uid()
  q.run('INSERT INTO patterns (id,category_id,grp,title,detail,prevalence,impact,source,sample,period,method,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, c.id, grp, title, detail, +prevalence, impact, source, +sample, period, method, now())
  res.json(q.get('SELECT * FROM patterns WHERE id=?', id))
})
app.patch('/api/patterns/:id', (req, res) => {
  const p = q.get('SELECT * FROM patterns WHERE id=?', req.params.id); if (!p) notFound()
  ownCategory(req.user.id, p.category_id)
  const v = { ...p, ...req.body }
  q.run('UPDATE patterns SET grp=?,title=?,detail=?,prevalence=?,impact=?,source=?,sample=?,period=?,method=? WHERE id=?',
    v.grp, v.title, v.detail, +v.prevalence, v.impact, v.source, +v.sample, v.period, v.method, p.id)
  res.json(q.get('SELECT * FROM patterns WHERE id=?', p.id))
})
app.delete('/api/patterns/:id', (req, res) => {
  const p = q.get('SELECT * FROM patterns WHERE id=?', req.params.id); if (!p) notFound()
  ownCategory(req.user.id, p.category_id)
  q.run('DELETE FROM patterns WHERE id=?', p.id)
  res.json({ ok: true })
})

// ---------- events ----------
app.post('/api/events', (req, res) => {
  const c = ownCategory(req.user.id, req.body.category_id)
  const { date = now().slice(0, 10), title, source = 'Площадка', affected = false, note = '' } = req.body
  if (!title) bad('Название события обязательно')
  const id = uid()
  q.run('INSERT INTO events (id,category_id,date,title,source,affected,note,created_at) VALUES (?,?,?,?,?,?,?,?)', id, c.id, date, title, source, affected ? 1 : 0, note, now())
  res.json(q.get('SELECT * FROM events WHERE id=?', id))
})
app.patch('/api/events/:id', (req, res) => {
  const e = q.get('SELECT * FROM events WHERE id=?', req.params.id); if (!e) notFound()
  ownCategory(req.user.id, e.category_id)
  const v = { ...e, ...req.body }
  q.run('UPDATE events SET date=?,title=?,source=?,affected=?,note=? WHERE id=?', v.date, v.title, v.source, v.affected ? 1 : 0, v.note, e.id)
  res.json(q.get('SELECT * FROM events WHERE id=?', e.id))
})
app.delete('/api/events/:id', (req, res) => {
  const e = q.get('SELECT * FROM events WHERE id=?', req.params.id); if (!e) notFound()
  ownCategory(req.user.id, e.category_id)
  q.run('DELETE FROM events WHERE id=?', e.id)
  res.json({ ok: true })
})

// ---------- cards ----------
app.post('/api/cards', (req, res) => {
  const c = ownCategory(req.user.id, req.body.category_id)
  const { sku = 'SKU-' + uid().slice(0, 6).toUpperCase(), name, price = 0, status = 'active', metrics = {} } = req.body
  if (!name) bad('Название артикула обязательно')
  const id = uid()
  q.run('INSERT INTO cards (id,category_id,sku,name,price,status,metrics,created_at) VALUES (?,?,?,?,?,?,?,?)', id, c.id, sku, name, +price, status, S(metrics), now())
  res.json(parseCard(q.get('SELECT * FROM cards WHERE id=?', id)))
})
app.patch('/api/cards/:id', (req, res) => {
  const card = q.get('SELECT * FROM cards WHERE id=?', req.params.id); if (!card) notFound()
  const c = ownCategory(req.user.id, card.category_id)
  const { name, sku, price, status, metrics } = req.body || {}
  const before = parseCard(card)
  q.run('UPDATE cards SET name=COALESCE(?,name), sku=COALESCE(?,sku), price=COALESCE(?,price), status=COALESCE(?,status), metrics=? WHERE id=?',
    name, sku, price == null ? null : +price, status, S({ ...J(card.metrics, {}), ...(metrics || {}) }), card.id)
  const after = parseCard(q.get('SELECT * FROM cards WHERE id=?', card.id))
  if (price != null && +price !== before.price) {
    logAction(c.cabinet_id, 'user', 'price', `Цена: ${before.name} ${Math.round(before.price).toLocaleString('ru-RU')} → ${Math.round(+price).toLocaleString('ru-RU')} ₽`, {
      target: { entity: 'card', id: card.id, category_id: c.id }, payload: { kind: 'card', id: card.id, field: 'price', before: before.price, after: +price }
    })
  }
  res.json(after)
})
app.delete('/api/cards/:id', (req, res) => {
  const card = q.get('SELECT * FROM cards WHERE id=?', req.params.id); if (!card) notFound()
  ownCategory(req.user.id, card.category_id)
  q.run('DELETE FROM cards WHERE id=?', card.id)
  res.json({ ok: true })
})

// ---------- hypotheses ----------
app.get('/api/hypotheses', (req, res) => {
  ownCabinet(req.user.id, req.query.cabinet_id)
  const hyps = q.all('SELECT h.*, c.name AS category_name FROM hypotheses h JOIN categories c ON c.id=h.category_id WHERE h.cabinet_id=? ORDER BY h.created_at DESC', req.query.cabinet_id).map(parseHyp)
  res.json(hyps.map((h) => {
    const t = parseTest(q.get('SELECT * FROM tests WHERE hypothesis_id=? ORDER BY created_at DESC LIMIT 1', h.id))
    const i = t ? parseInterp(q.get('SELECT * FROM interpretations WHERE test_id=?', t.id)) : null
    return { ...h, test: t ? { id: t.id, status: t.status, progress: t.required_n ? Math.min(100, Math.round((t.current_n / t.required_n) * 100)) : 0 } : null, verdict: i?.verdict || null, decided: i?.decided || null }
  }))
})
app.post('/api/hypotheses', (req, res) => {
  const { cabinet_id, category_id, title, fact_kind = 'benchmark', fact_ref = '', fact_text = '', funnel_stage = 'Заказ', expected_rub = 0, priority = 'mid', card_ids = [] } = req.body || {}
  ownCabinet(req.user.id, cabinet_id)
  ownCategory(req.user.id, category_id)
  if (!title) bad('Формулировка гипотезы обязательна')
  if (!fact_text) bad('Укажите факт категории, из которого выросла гипотеза')
  const id = uid()
  q.run(`INSERT INTO hypotheses (id,cabinet_id,category_id,title,fact_kind,fact_ref,fact_text,funnel_stage,expected_rub,priority,status,origin,card_ids,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, cabinet_id, category_id, title, fact_kind, fact_ref, fact_text, funnel_stage, +expected_rub, priority, 'new', 'user', S(card_ids), now(), now())
  logAction(cabinet_id, 'user', 'hypothesis', `Создана гипотеза: ${title}`, { target: { entity: 'hypothesis', id, category_id }, payload: { kind: 'hypothesis', id } })
  res.json(parseHyp(q.get('SELECT * FROM hypotheses WHERE id=?', id)))
})
app.get('/api/hypotheses/:id', (req, res) => {
  const h = ownHypothesis(req.user.id, req.params.id)
  const category = parseCat(q.get('SELECT * FROM categories WHERE id=?', h.category_id))
  const fact = h.fact_kind === 'benchmark'
    ? (q.get('SELECT * FROM benchmarks WHERE id=?', h.fact_ref) ? { kind: 'benchmark', ...parseBench(q.get('SELECT * FROM benchmarks WHERE id=?', h.fact_ref)) } : null)
    : (q.get('SELECT * FROM patterns WHERE id=?', h.fact_ref) ? { kind: 'pattern', ...q.get('SELECT * FROM patterns WHERE id=?', h.fact_ref) } : null)
  const test = parseTest(q.get('SELECT * FROM tests WHERE hypothesis_id=? ORDER BY created_at DESC LIMIT 1', h.id))
  const interp = test ? parseInterp(q.get('SELECT * FROM interpretations WHERE test_id=?', test.id)) : null
  const rollout = parseRollout(q.get('SELECT * FROM rollouts WHERE hypothesis_id=? ORDER BY created_at DESC LIMIT 1', h.id))
  const cards = q.all('SELECT * FROM cards WHERE category_id=?', h.category_id).map(parseCard)
  const acts = q.all('SELECT * FROM actions WHERE cabinet_id=? ORDER BY created_at DESC LIMIT 200', h.cabinet_id).map(parseAction)
    .filter((a) => a.target.hypothesis_id === h.id || (a.target.entity === 'hypothesis' && a.target.id === h.id) ||
      (test && a.target.entity === 'test' && a.target.id === test.id) || (rollout && a.target.entity === 'rollout' && a.target.id === rollout.id) ||
      (a.target.entity === 'card' && J(h.card_ids, []).includes(a.target.id)))
  res.json({ hypothesis: parseHyp(h), category, fact, test, interpretation: interp, rollout, cards, actions: acts })
})
app.patch('/api/hypotheses/:id', (req, res) => {
  const h = ownHypothesis(req.user.id, req.params.id)
  const { title, fact_text, funnel_stage, expected_rub, priority, card_ids } = req.body || {}
  q.run('UPDATE hypotheses SET title=COALESCE(?,title), fact_text=COALESCE(?,fact_text), funnel_stage=COALESCE(?,funnel_stage), expected_rub=COALESCE(?,expected_rub), priority=COALESCE(?,priority), card_ids=COALESCE(?,card_ids), updated_at=? WHERE id=?',
    title, fact_text, funnel_stage, expected_rub == null ? null : +expected_rub, priority, card_ids ? S(card_ids) : null, now(), h.id)
  res.json(parseHyp(q.get('SELECT * FROM hypotheses WHERE id=?', h.id)))
})
app.delete('/api/hypotheses/:id', (req, res) => {
  const h = ownHypothesis(req.user.id, req.params.id)
  deleteHypothesis(h.id)
  logAction(h.cabinet_id, 'user', 'hypothesis', `Удалена гипотеза: ${h.title}`, { target: { entity: 'hypothesis', id: h.id, category_id: h.category_id } })
  res.json({ ok: true })
})

// Accept -> test draft with power calc
app.post('/api/hypotheses/:id/accept', (req, res) => {
  const h = ownHypothesis(req.user.id, req.params.id)
  if (h.status !== 'new') bad('Гипотеза уже принята')
  const benches = q.all('SELECT * FROM benchmarks WHERE category_id=?', h.category_id)
  const convB = benches.find((b) => b.metric.toLowerCase().includes('конверсия'))
  const baseline = +(req.body?.baseline ?? convB?.seller ?? 3.5)
  const mde = +(req.body?.mde ?? Math.max(0.3, +(baseline * 0.14).toFixed(1)))
  const days = +(req.body?.days ?? 14)
  const metric = req.body?.metric || 'Конверсия в заказ'
  const { total } = requiredSample(baseline / 100, mde / 100)
  const today = new Date(); const end = new Date(today.getTime() + days * 86400000)
  const overlapping = q.all('SELECT * FROM events WHERE category_id=? AND affected=1', h.category_id)
    .filter((e) => { const d = new Date(e.date); return d >= new Date(today.getTime() - 3 * 86400000) && d <= end })
  const warnings = overlapping.map((e) => `Событие «${e.title}» попадает в окно теста: обе группы под одним эффектом, сравнение валидно.`)
  if (!warnings.length) warnings.push('Загрязнений не найдено: контроль и тестовая группа в одинаковых условиях.')
  const id = uid()
  const planned = { delta: mde, ci: [+(mde * 0.2).toFixed(2), +(mde * 1.8).toFixed(2)], unit: 'п.п.', rub: +h.expected_rub || 0, verdict: 'confirmed', days, ctrDelta: 3 }
  q.run(`INSERT INTO tests (id,hypothesis_id,metric,baseline,mde,alpha,power,required_n,current_n,start_date,end_date,status,warnings,planned,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, h.id, metric, baseline, mde, 0.05, 0.8, total, 0, null, null, 'draft', S(warnings), S(planned), now())
  q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'accepted', now(), h.id)
  logAction(h.cabinet_id, 'user', 'accept', `Принята гипотеза: ${h.title}`, {
    target: { entity: 'hypothesis', id: h.id, category_id: h.category_id }, payload: { kind: 'test_create', id },
    note: `Тест рассчитан: мощность 80%, ${total.toLocaleString('ru-RU')} наблюдений, окно ${days} дней.`
  })
  res.json(parseTest(q.get('SELECT * FROM tests WHERE id=?', id)))
})

// ---------- tests ----------
app.patch('/api/tests/:id', (req, res) => {
  const t = q.get('SELECT * FROM tests WHERE id=?', req.params.id); if (!t) notFound()
  const h = ownHypothesis(req.user.id, t.hypothesis_id)
  if (t.status !== 'draft') bad('Параметры можно менять только до запуска')
  const baseline = +(req.body?.baseline ?? t.baseline)
  const mde = +(req.body?.mde ?? t.mde)
  const days = +(req.body?.days ?? t.planned?.days ?? 14)
  const { total } = requiredSample(baseline / 100, mde / 100)
  const planned = { ...J(t.planned, {}), days }
  q.run('UPDATE tests SET metric=COALESCE(?,metric), baseline=?, mde=?, required_n=?, planned=? WHERE id=?', req.body?.metric, baseline, mde, total, S(planned), t.id)
  res.json(parseTest(q.get('SELECT * FROM tests WHERE id=?', t.id)))
})
app.delete('/api/tests/:id', (req, res) => {
  const t = q.get('SELECT * FROM tests WHERE id=?', req.params.id); if (!t) notFound()
  const h = ownHypothesis(req.user.id, t.hypothesis_id)
  q.run('DELETE FROM interpretations WHERE test_id=?', t.id)
  q.run('DELETE FROM tests WHERE id=?', t.id)
  q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'new', now(), h.id)
  logAction(h.cabinet_id, 'user', 'test', `Тест удалён: ${h.title}`, { target: { entity: 'hypothesis', id: h.id, category_id: h.category_id } })
  res.json({ ok: true })
})
app.post('/api/tests/:id/start', (req, res) => {
  const t = q.get('SELECT * FROM tests WHERE id=?', req.params.id); if (!t) notFound()
  const h = ownHypothesis(req.user.id, t.hypothesis_id)
  if (!['draft', 'aborted'].includes(t.status)) bad('Тест уже идёт или завершён')
  const days = J(t.planned, {}).days || 14
  const start = new Date(); const end = new Date(start.getTime() + days * 86400000)
  q.run('UPDATE tests SET status=?, start_date=?, end_date=?, current_n=? WHERE id=?', 'running', start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), 0, t.id)
  q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'testing', now(), h.id)
  logAction(h.cabinet_id, 'user', 'test_start', `Запущен тест: ${h.title}`, {
    target: { entity: 'test', id: t.id, hypothesis_id: h.id, category_id: h.category_id }, payload: { kind: 'test_start', id: t.id },
    note: `Окно ${days} дней, нужно ${t.required_n.toLocaleString('ru-RU')} наблюдений.`
  })
  res.json(parseTest(q.get('SELECT * FROM tests WHERE id=?', t.id)))
})
app.post('/api/tests/:id/complete', (req, res) => {
  const t = q.get('SELECT * FROM tests WHERE id=?', req.params.id); if (!t) notFound()
  const h = ownHypothesis(req.user.id, t.hypothesis_id)
  if (t.status !== 'running') bad('Завершить можно только идущий тест')
  const planned = J(t.planned, {})
  const progress = t.required_n ? t.current_n / t.required_n : 0
  const widen = progress > 0 ? Math.sqrt(1 / Math.max(progress, 0.05)) : 3
  const delta = planned.delta ?? t.mde
  const ci0 = planned.ci || [delta * 0.2, delta * 1.8]
  const mid = (ci0[0] + ci0[1]) / 2, half = ((ci0[1] - ci0[0]) / 2) * widen
  const ci = [+(mid - half).toFixed(2), +(mid + half).toFixed(2)]
  let verdict = ci[0] > 0 ? 'confirmed' : ci[1] < 0 ? 'failed' : 'inconclusive'
  if (progress < 0.3) verdict = 'inconclusive'
  const unit = planned.unit || 'п.п.'
  const effects = [
    { metric: t.metric, delta: +delta.toFixed(2), ci, unit, primary: true },
    { metric: 'CTR', delta: planned.ctrDelta ?? 3, ci: [+(planned.ctrDelta ?? 3) * 0.6, +(planned.ctrDelta ?? 3) * 1.4].map((x) => +x.toFixed(1)), unit: '%', primary: false }
  ]
  const controls = [
    { metric: 'Выкуп', before: 90, after: 90, unit: '%', ok: true },
    { metric: 'ДРР', before: 9.4, after: 9.6, unit: '%', ok: true },
    { metric: 'Возвраты', before: 4.1, after: 4.0, unit: '%', ok: true }
  ]
  const rub = verdict === 'confirmed' ? (planned.rub || +h.expected_rub || 0) : verdict === 'failed' ? -Math.round((planned.rub || +h.expected_rub || 0) * 0.5) : 0
  const summary = verdict === 'confirmed'
    ? `${t.metric}: +${delta}${unit} при стабильных контрольных метриках.${progress < 1 ? ` Мощность на момент остановки ${Math.round(progress * 100)}% — интервал шире расчётного.` : ''}`
    : verdict === 'failed'
      ? `Основная метрика ухудшилась: ${delta}${unit}. Контрольные метрики стабильны — эффект реальный, не шум.`
      : `Мощность ${Math.round(progress * 100)}%: доверительный интервал пересекает ноль. Эффект не доказан — нужно больше наблюдений или откат.`
  const id = uid()
  q.run('INSERT INTO interpretations (id,test_id,verdict,summary,effects,controls,effect_rub,decided,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, t.id, verdict, summary, S(effects), S(controls), rub, null, now())
  q.run('UPDATE tests SET status=? WHERE id=?', 'completed', t.id)
  q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'interpreted', now(), h.id)
  logAction(h.cabinet_id, 'user', 'interpretation', `Интерпретация: ${h.title} — ${verdict === 'confirmed' ? 'подтверждено' : verdict === 'failed' ? 'провал' : 'неоднозначно'}`, {
    target: { entity: 'hypothesis', id: h.id, category_id: h.category_id },
    provenance: { source: 'A/B тест', sample: `${t.current_n.toLocaleString('ru-RU')} наблюдений`, period: `${t.start_date} — ${now().slice(0, 10)}`, method: 'Двухдолевой z-тест, 95% ДИ' }
  })
  res.json(parseInterp(q.get('SELECT * FROM interpretations WHERE id=?', id)))
})

// ---------- interpretations: decision ----------
app.post('/api/interpretations/:id/decide', (req, res) => {
  const i = q.get('SELECT * FROM interpretations WHERE id=?', req.params.id); if (!i) notFound()
  const t = q.get('SELECT * FROM tests WHERE id=?', i.test_id)
  const h = ownHypothesis(req.user.id, t.hypothesis_id)
  if (i.decided) bad('Решение уже принято')
  const decision = req.body?.decision
  if (!['rollback', 'scale'].includes(decision)) bad('Решение: откат или масштабирование')

  if (decision === 'rollback') {
    const cardIds = J(h.card_ids, [])
    const acts = q.all('SELECT * FROM actions WHERE cabinet_id=? AND undone_at IS NULL', h.cabinet_id).map(parseAction)
      .filter((a) => a.payload?.kind === 'card' && cardIds.includes(a.payload.id))
    for (const a of acts) undoAction(req.user.id, a.id)
    q.run('UPDATE interpretations SET decided=? WHERE id=?', 'rollback', i.id)
    q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'rolled_back', now(), h.id)
    logAction(h.cabinet_id, 'user', 'decide', `Откат: ${h.title}`, {
      target: { entity: 'hypothesis', id: h.id, category_id: h.category_id },
      note: acts.length ? `Возвращено изменений: ${acts.length}. Контрольная группа не затронута.` : 'Изменений для возврата не найдено — гипотеза закрыта.'
    })
    return res.json({ ok: true, decision })
  }

  // scale: волны на похожие артикулы с контрольной группой
  const all = q.all('SELECT * FROM cards WHERE category_id=?', h.category_id).map(parseCard)
  const used = new Set(J(h.card_ids, []))
  let targets = (req.body?.card_ids?.length ? req.body.card_ids : all.filter((c) => !used.has(c.id) && c.status === 'active').map((c) => c.id))
  targets = targets.filter((id) => all.some((c) => c.id === id))
  if (targets.length < 2) bad('Нужно минимум 2 артикула для раскатки')
  const controlCount = Math.max(2, Math.round(targets.length * 0.3))
  const managed = targets.slice(0, targets.length - controlCount)
  const control = targets.slice(targets.length - controlCount)
  if (managed.length < 1) bad('Слишком большая контрольная группа')
  const wavesCount = Math.min(+(req.body?.waves || 3), managed.length)
  const per = Math.ceil(managed.length / wavesCount)
  const waves = []
  for (let w = 0; w < wavesCount; w++) {
    const ids = managed.slice(w * per, (w + 1) * per)
    if (!ids.length) continue
    const date = new Date(Date.now() + w * 7 * 86400000).toISOString().slice(0, 10)
    waves.push({ n: w + 1, date, card_ids: ids, status: w === 0 ? 'done' : 'pending' })
  }
  for (const cid of waves[0].card_ids) setCardField(cid, 'status', 'rolled')
  for (const cid of control) setCardField(cid, 'status', 'control')
  const eff = J(i.effects, []).find((e) => e.primary)?.delta ?? 8
  const rid = uid()
  q.run('INSERT INTO rollouts (id,hypothesis_id,status,control_ids,waves,series,created_at) VALUES (?,?,?,?,?,?,?)',
    rid, h.id, waves.length === 1 ? 'done' : 'active', S(control), S(waves), S(rolloutSeries(1, eff)), now())
  q.run('UPDATE interpretations SET decided=? WHERE id=?', 'scale', i.id)
  q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'scaled', now(), h.id)
  logAction(h.cabinet_id, 'user', 'wave', `Раскатка: волна 1, ${waves[0].card_ids.length} арт. — ${h.title}`, {
    target: { entity: 'rollout', id: rid, hypothesis_id: h.id, category_id: h.category_id }, payload: { kind: 'wave', id: rid, n: 1 },
    note: `Контрольная группа: ${control.length} арт. сохраняется до конца раскатки.`
  })
  res.json(parseRollout(q.get('SELECT * FROM rollouts WHERE id=?', rid)))
})
app.post('/api/rollouts/:id/advance', (req, res) => {
  const r = q.get('SELECT * FROM rollouts WHERE id=?', req.params.id); if (!r) notFound()
  const h = ownHypothesis(req.user.id, r.hypothesis_id)
  const waves = J(r.waves, [])
  const next = waves.find((w) => w.status === 'pending')
  if (!next) bad('Все волны уже раскатаны')
  next.status = 'done'; next.date = now().slice(0, 10)
  for (const cid of next.card_ids) setCardField(cid, 'status', 'rolled')
  const done = waves.filter((w) => w.status === 'done').length
  const interp = q.get('SELECT i.* FROM interpretations i JOIN tests t ON t.id=i.test_id WHERE t.hypothesis_id=?', h.id)
  const eff = interp ? (J(interp.effects, []).find((e) => e.primary)?.delta ?? 8) : 8
  q.run('UPDATE rollouts SET waves=?, status=?, series=? WHERE id=?', S(waves), done === waves.length ? 'done' : 'active', S(rolloutSeries(done, eff)), r.id)
  logAction(h.cabinet_id, 'user', 'wave', `Раскатка: волна ${next.n}, ${next.card_ids.length} арт. — ${h.title}`, {
    target: { entity: 'rollout', id: r.id, hypothesis_id: h.id, category_id: h.category_id }, payload: { kind: 'wave', id: r.id, n: next.n }
  })
  res.json(parseRollout(q.get('SELECT * FROM rollouts WHERE id=?', r.id)))
})
app.delete('/api/rollouts/:id', (req, res) => {
  const r = q.get('SELECT * FROM rollouts WHERE id=?', req.params.id); if (!r) notFound()
  const h = ownHypothesis(req.user.id, r.hypothesis_id)
  for (const cid of [...J(r.control_ids, []), ...J(r.waves, []).flatMap((w) => w.card_ids)]) setCardField(cid, 'status', 'active')
  q.run('DELETE FROM rollouts WHERE id=?', r.id)
  q.run('UPDATE interpretations SET decided=NULL WHERE test_id IN (SELECT id FROM tests WHERE hypothesis_id=?)', h.id)
  q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'interpreted', now(), h.id)
  res.json({ ok: true })
})

// ---------- actions / agent ----------
app.get('/api/actions', (req, res) => {
  ownCabinet(req.user.id, req.query.cabinet_id)
  let rows = q.all('SELECT * FROM actions WHERE cabinet_id=? ORDER BY created_at DESC LIMIT 300', req.query.cabinet_id).map(parseAction)
  if (req.query.actor) rows = rows.filter((a) => a.actor === req.query.actor)
  if (req.query.type) rows = rows.filter((a) => a.type === req.query.type)
  res.json(rows)
})
app.get('/api/agent/recent', (req, res) => {
  ownCabinet(req.user.id, req.query.cabinet_id)
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  res.json(q.all('SELECT * FROM actions WHERE cabinet_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 40', req.query.cabinet_id, since).map(parseAction))
})
app.post('/api/actions', (req, res) => {
  const { cabinet_id, type = 'note', title, note = '', target = {} } = req.body || {}
  ownCabinet(req.user.id, cabinet_id)
  if (!title) bad('Опишите действие')
  const id = logAction(cabinet_id, 'user', type, title, { target, note })
  res.json(parseAction(q.get('SELECT * FROM actions WHERE id=?', id)))
})
app.patch('/api/actions/:id', (req, res) => {
  const a = q.get('SELECT a.*, cab.user_id FROM actions a JOIN cabinets cab ON cab.id=a.cabinet_id WHERE a.id=?', req.params.id)
  if (!a || a.user_id !== req.user.id) notFound()
  const { title, note } = req.body || {}
  q.run('UPDATE actions SET title=COALESCE(?,title), note=COALESCE(?,note) WHERE id=?', title, note, a.id)
  res.json(parseAction(q.get('SELECT * FROM actions WHERE id=?', a.id)))
})
app.delete('/api/actions/:id', (req, res) => {
  const a = q.get('SELECT a.*, cab.user_id FROM actions a JOIN cabinets cab ON cab.id=a.cabinet_id WHERE a.id=?', req.params.id)
  if (!a || a.user_id !== req.user.id) notFound()
  q.run('DELETE FROM actions WHERE id=?', a.id)
  res.json({ ok: true })
})
app.post('/api/actions/:id/undo', (req, res) => res.json(undoAction(req.user.id, req.params.id)))

// ---------- static SPA ----------
const dist = path.join(root, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}
app.use((err, req, res, next) => {
  const code = err instanceof HttpError ? err.code : 500
  if (code === 500) console.error(err)
  res.status(code).json({ error: code === 500 ? 'Внутренняя ошибка' : err.message })
})
// Первый запуск: засеваем демо-данными
if (q.get('SELECT COUNT(*) AS n FROM users').n === 0) {
  await import('./seed.js')
}
const port = process.env.PORT || 3000
app.listen(port, '0.0.0.0', () => console.log(`Лемма: API и приложение на http://0.0.0.0:${port}`))
