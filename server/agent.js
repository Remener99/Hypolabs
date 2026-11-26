// Агентный цикл «Леммы»: детерминированный сбор фактов из базы → LLM (AITunnel)
// → строгая валидация → черновики гипотез / совет по интерпретации.
// Агент никогда не меняет карточки и не принимает решения — только предлагает,
// каждое изменение с журналом, «как получено» и откатом.
import { q, uid, now, S, J } from './db.js'
import { benchStatus } from './stats.js'
import { HttpError, bad, notFound, ownCabinet, ownCategory, logAction, parseBench, parseCard, parseInterp } from './util.js'
import { llmChat, extractJson, agentConfigured, agentModel, estimateCost } from './llm.js'

const FUNNEL = ['Показ', 'Клик', 'Корзина', 'Заказ', 'Выкуп']
const MONTH_BUDGET = () => +(process.env.AGENT_MONTH_BUDGET_RUB || 50)
const COOLDOWN_MS = 20000

const running = new Set()
const lastRunAt = new Map()

export function monthSpent() {
  const since = now().slice(0, 7) + '-01'
  return +(q.get('SELECT COALESCE(SUM(cost_rub),0) s FROM agent_runs WHERE created_at>=?', since)?.s || 0).toFixed(4)
}
export function agentStatus() {
  return { configured: agentConfigured(), model: agentModel(), month_spent_rub: monthSpent(), month_budget_rub: MONTH_BUDGET() }
}

const insertRun = (cabinetId, mode, scope, fields) => {
  const id = uid()
  const f = { status: 'ok', model: agentModel(), tokens_in: 0, tokens_out: 0, cost_rub: 0, duration_ms: 0, created_count: 0, summary: null, error: null, ...fields }
  q.run(`INSERT INTO agent_runs (id,cabinet_id,mode,scope,status,model,tokens_in,tokens_out,cost_rub,duration_ms,created_count,summary,error,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, cabinetId, mode, scope, f.status, f.model, f.tokens_in, f.tokens_out, f.cost_rub, f.duration_ms, f.created_count, f.summary, f.error, now())
  return q.get('SELECT * FROM agent_runs WHERE id=?', id)
}

// ---------- контекст для поиска разрывов (только факты из базы) ----------
function scanContext(userId, cabinetId, categoryId) {
  const cab = ownCabinet(userId, cabinetId)
  let cats = q.all('SELECT * FROM categories WHERE cabinet_id=? ORDER BY created_at', cabinetId)
  if (categoryId) { ownCategory(userId, categoryId); cats = cats.filter((c) => c.id === categoryId) }
  if (!cats.length) bad('В кабинете нет категорий — добавьте категорию с бенчмарками')
  const categories = cats.slice(0, 6).map((c) => {
    const benches = q.all('SELECT * FROM benchmarks WHERE category_id=?', c.id).map(parseBench)
    const cards = q.all('SELECT * FROM cards WHERE category_id=?', c.id).map(parseCard)
    const patterns = q.all('SELECT * FROM patterns WHERE category_id=? ORDER BY prevalence DESC', c.id)
    const events = q.all('SELECT * FROM events WHERE category_id=? ORDER BY date DESC LIMIT 3', c.id)
    const hyps = q.all('SELECT title, status, fact_ref FROM hypotheses WHERE category_id=? ORDER BY created_at DESC LIMIT 12', c.id)
    const revenue30 = cards.reduce((s, x) => s + (x.price || 0) * (x.metrics.orders || 0), 0)
    const withStatus = benches.map((b) => ({ b, st: benchStatus(b) }))
    withStatus.sort((a, b) => (a.st.key === 'gap' ? 0 : a.st.key === 'warn' ? 1 : 2) - (b.st.key === 'gap' ? 0 : b.st.key === 'warn' ? 1 : 2))
    return {
      id: c.id, name: c.name, marketplace: c.marketplace, thesis: c.thesis, revenue30_rub: Math.round(revenue30),
      benchmarks: withStatus.slice(0, 8).map(({ b, st }) => ({
        id: b.id, metric: b.metric, unit: b.unit, seller: b.seller, p25: b.p25, p50: b.p50, p75: b.p75,
        leader: b.leader, higher_better: !!b.higher_better, status: st.label
      })),
      patterns: patterns.slice(0, 6).map((p) => ({ id: p.id, grp: p.grp, title: p.title, detail: (p.detail || '').slice(0, 140), prevalence_pct: p.prevalence, impact: p.impact })),
      events: events.map((e) => ({ date: e.date, title: e.title, affected: !!e.affected })),
      cards: cards.slice(0, 8).map((x) => ({ id: x.id, name: x.name, price_rub: x.price, status: x.status, metrics: x.metrics })),
      existing_hypotheses: hyps.map((h) => ({ title: h.title, status: h.status, fact_ref: h.fact_ref }))
    }
  })
  return { cabinet: { name: cab.name, marketplace: cab.marketplace }, categories }
}

const SCAN_SYSTEM = `Ты — агент роста «Лемма» для продавцов маркетплейсов. Работаешь ТОЛЬКО с данными из контекста: не выдумывай числа, метрики и факты. Пиши по-русски, коротко и однозначно, без жаргона. Отвечай СТРОГО валидным JSON без пояснений и markdown.`

const scanPrompt = (ctx) => `Данные кабинета (бенчмарки категории, паттерны лидеров, события, карточки, существующие гипотезы):
${JSON.stringify(ctx)}

Задача: найти разрывы с нормой категории и предложить от 0 до 3 НОВЫХ гипотез роста. Если все метрики в норме — верни пустой список.
Правила:
- Каждая гипотеза опирается на конкретный факт: benchmark или pattern из контекста, укажи его id в fact_ref.
- Не повторяй existing_hypotheses (даже близко по смыслу).
- title — конкретное изменение карточек, до 90 символов.
- fact_text — факт с числами из контекста, до 200 символов.
- reason — почему это должно сработать: связь факта, стадии воронки и паттерна лидеров, до 220 символов.
- expected_rub — консервативная оценка эффекта на выручку в месяц, целое ₽; опирайся на revenue30_rub категории и величину разрыва, не завышай.
- funnel_stage — ровно одно из: Показ, Клик, Корзина, Заказ, Выкуп.
- priority: high | mid | low. card_ids — до 6 id карточек этой категории, которых касается изменение.
Формат ответа:
{"summary":"1-2 предложения: что проверил и что нашёл","hypotheses":[{"category_id":"...","title":"...","fact_kind":"benchmark","fact_ref":"...","fact_text":"...","funnel_stage":"Заказ","expected_rub":120000,"priority":"mid","reason":"...","card_ids":["..."]}]}`

// ---------- контекст интерпретации ----------
function interpretContext(userId, interpId) {
  const i = q.get('SELECT * FROM interpretations WHERE id=?', interpId)
  if (!i) notFound('Интерпретация не найдена')
  const t = q.get('SELECT * FROM tests WHERE id=?', i.test_id)
  const h = q.get('SELECT h.*, cab.user_id FROM hypotheses h JOIN cabinets cab ON cab.id=h.cabinet_id WHERE h.id=?', t?.hypothesis_id)
  if (!h || h.user_id !== userId) notFound('Интерпретация не найдена')
  const cat = q.get('SELECT * FROM categories WHERE id=?', h.category_id)
  const cardsTotal = q.get('SELECT COUNT(*) n FROM cards WHERE category_id=?', h.category_id).n
  return {
    h, t, i,
    ctx: {
      hypothesis: { title: h.title, funnel_stage: h.funnel_stage, fact_text: h.fact_text, expected_rub: h.expected_rub },
      category: { name: cat?.name, cards_total: cardsTotal },
      test: { metric: t.metric, baseline: t.baseline, required_n: t.required_n, current_n: t.current_n, progress_pct: t.required_n ? Math.round((t.current_n / t.required_n) * 100) : 0, warnings: J(t.warnings, []) },
      interpretation: { verdict: i.verdict, summary: i.summary, effects: J(i.effects, []), controls: J(i.controls, []), effect_rub: i.effect_rub }
    }
  }
}

const INTERPRET_SYSTEM = `Ты — агент роста «Лемма». Объясняешь результаты A/B-теста продавцу маркетплейса. Вердикт уже рассчитан статистикой — не меняй и не оспаривай его, только объясни. Пиши по-русски, коротко, без жаргона. Отвечай СТРОГО валидным JSON без пояснений и markdown.`

const interpretPrompt = (ctx) => `Результат теста:
${JSON.stringify(ctx)}

Задача: объяснить результат и порекомендовать одно из двух действий.
Правила:
- explanation — 2-3 простых предложения: что показал тест, что значит доверительный интервал (пересекает ноль или нет), хватает ли мощности.
- recommendation: "scale" (раскатать волнами с контрольной группой) если verdict=confirmed; "rollback" (откатить) если verdict=failed; при inconclusive выбери сам и обоснуй.
- reason — 1-2 предложения, почему именно это действие, с числами из контекста.
- watch — до 3 метрик, за которыми следить после решения.
Формат ответа:
{"explanation":"...","recommendation":"scale","reason":"...","watch":["Выкуп","ДРР"]}`

// ---------- валидация ответа LLM (сервер не доверяет модели) ----------
const normTitle = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

function validateHypothesis(raw, ctx, cabinetId) {
  if (!raw || typeof raw !== 'object') return { skip: 'пустая гипотеза' }
  const cat = ctx.categories.find((c) => c.id === raw.category_id)
  if (!cat) return { skip: 'модель указала неизвестную категорию' }
  const kind = raw.fact_kind === 'pattern' ? 'pattern' : 'benchmark'
  const ref = (kind === 'benchmark' ? cat.benchmarks : cat.patterns).find((x) => x.id === raw.fact_ref)
  if (!ref) return { skip: 'факт не найден в данных категории' }
  const title = String(raw.title || '').trim().slice(0, 120)
  const factText = String(raw.fact_text || '').trim().slice(0, 300)
  if (title.length < 8) return { skip: 'слишком короткая формулировка' }
  if (factText.length < 10) return { skip: 'нет факта с числами' }
  const dup = q.all('SELECT title, status, fact_ref FROM hypotheses WHERE cabinet_id=?', cabinetId)
    .find((x) => normTitle(x.title) === normTitle(title) || (x.fact_ref && x.fact_ref === raw.fact_ref && ['new', 'accepted', 'testing'].includes(x.status)))
  if (dup) return { skip: 'такая гипотеза уже есть' }
  const rub = Math.max(0, Math.min(10000000, Math.round(+raw.expected_rub || 0)))
  const cardIds = (Array.isArray(raw.card_ids) ? raw.card_ids : []).filter((id) => cat.cards.some((c) => c.id === id)).slice(0, 6)
  return {
    hyp: {
      category_id: cat.id, title, fact_kind: kind, fact_ref: ref.id, fact_text: factText,
      funnel_stage: FUNNEL.includes(raw.funnel_stage) ? raw.funnel_stage : 'Заказ',
      expected_rub: rub, priority: ['high', 'mid', 'low'].includes(raw.priority) ? raw.priority : 'mid',
      reason: String(raw.reason || '').trim().slice(0, 400), card_ids: cardIds
    }
  }
}

function validateAdvice(raw) {
  if (!raw || typeof raw !== 'object') bad('модель вернула пустой совет')
  const rec = raw.recommendation
  if (!['scale', 'rollback'].includes(rec)) throw new HttpError(502, 'Модель не выбрала действие (scale/rollback). Попробуйте ещё раз.')
  const explanation = String(raw.explanation || '').trim().slice(0, 700)
  const reason = String(raw.reason || '').trim().slice(0, 500)
  if (explanation.length < 20 || reason.length < 10) throw new HttpError(502, 'Модель вернула слишком короткое объяснение. Попробуйте ещё раз.')
  const watch = (Array.isArray(raw.watch) ? raw.watch : []).map((x) => String(x).slice(0, 40)).slice(0, 3)
  return { recommendation: rec, explanation, reason, watch }
}

// ---------- исполнение цикла ----------
export async function runAgent(userId, { cabinet_id, mode = 'scan', category_id, interpretation_id }) {
  const cab = ownCabinet(userId, cabinet_id)
  if (!agentConfigured()) bad('Агент не настроен: добавьте AITUNNEL_API_KEY в переменные окружения сервера (инструкция — в DEPLOY.md)')
  if (!['scan', 'interpret'].includes(mode)) bad('Режим: scan или interpret')
  const budget = MONTH_BUDGET()
  const spent = monthSpent()
  if (budget > 0 && spent >= budget) bad(`Лимит агента на месяц исчерпан: ${spent.toFixed(2)} ₽ из ${budget} ₽. Увеличьте AGENT_MONTH_BUDGET_RUB или дождитесь следующего месяца.`)
  if (running.has(cab.id)) throw new HttpError(409, 'Агент уже работает в этом кабинете — дождитесь завершения')
  const last = lastRunAt.get(cab.id) || 0
  if (Date.now() - last < COOLDOWN_MS) bad(`Подождите ${Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000)} с перед следующим запуском`)
  running.add(cab.id)
  const t0 = Date.now()
  try {
    const result = mode === 'scan'
      ? await runScan(userId, cab, category_id, t0)
      : await runInterpret(userId, cab, interpretation_id, t0)
    lastRunAt.set(cab.id, Date.now())
    return result
  } catch (e) {
    insertRun(cab.id, mode, category_id || interpretation_id || null, {
      status: 'error', error: String(e.message || 'Ошибка').slice(0, 300), duration_ms: Date.now() - t0
    })
    throw e
  } finally {
    running.delete(cab.id)
  }
}

async function runScan(userId, cab, categoryId, t0) {
  const ctx = scanContext(userId, cab.id, categoryId)
  const llm = await llmChat({ system: SCAN_SYSTEM, user: scanPrompt(ctx), maxTokens: 1500, temperature: 0.3 })
  let out
  try { out = extractJson(llm.content) } catch (e) {
    insertRun(cab.id, 'scan', categoryId || null, { status: 'error', model: llm.model, tokens_in: llm.tokensIn, tokens_out: llm.tokensOut, cost_rub: llm.cost, duration_ms: Date.now() - t0, error: e.message })
    throw e
  }
  const created = [], skipped = []
  for (const raw of (Array.isArray(out.hypotheses) ? out.hypotheses : []).slice(0, 3)) {
    const v = validateHypothesis(raw, ctx, cab.id)
    if (!v.hyp) { skipped.push(v.skip); continue }
    const h = v.hyp
    const id = uid()
    q.run(`INSERT INTO hypotheses (id,cabinet_id,category_id,title,fact_kind,fact_ref,fact_text,funnel_stage,expected_rub,priority,status,origin,card_ids,agent_reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, cab.id, h.category_id, h.title, h.fact_kind, h.fact_ref, h.fact_text, h.funnel_stage, h.expected_rub, h.priority, 'new', 'agent', S(h.card_ids), h.reason || null, now(), now())
    logAction(cab.id, 'agent', 'hypothesis', `Создана гипотеза: ${h.title}`, {
      target: { entity: 'hypothesis', id, category_id: h.category_id },
      payload: { kind: 'hypothesis', id },
      note: h.reason || null,
      provenance: {
        source: `Агент · ${llm.model} (AITunnel)`,
        sample: `${ctx.categories.length} категорий, ${ctx.categories.reduce((s, c) => s + c.benchmarks.length, 0)} бенчмарков, ${ctx.categories.reduce((s, c) => s + c.patterns.length, 0)} паттернов`,
        period: now().slice(0, 10),
        method: `Факты собраны из базы, гипотеза сформулирована моделью и проверена сервером. ≈${llm.cost.toFixed(2)} ₽ за запуск`
      }
    })
    created.push({ id, title: h.title, category_id: h.category_id, expected_rub: h.expected_rub })
  }
  const facts = ctx.categories.reduce((s, c) => s + c.benchmarks.length + c.patterns.length, 0)
  const summary = String(out.summary || '').trim().slice(0, 300) || (created.length ? `Создано черновиков: ${created.length}.` : 'Новых разрывов не найдено.')
  const run = insertRun(cab.id, 'scan', categoryId || null, {
    model: llm.model, tokens_in: llm.tokensIn, tokens_out: llm.tokensOut, cost_rub: llm.cost,
    duration_ms: Date.now() - t0, created_count: created.length, summary
  })
  logAction(cab.id, 'agent', 'agent_scan', `Агент разобрал ${facts} фактов: ${created.length ? `новых гипотез — ${created.length}` : 'всё в норме'}`, {
    target: categoryId ? { entity: 'category', id: categoryId } : {},
    note: `${llm.model} · ${llm.tokensIn + llm.tokensOut} токенов ≈ ${llm.cost.toFixed(2)} ₽. Черновики ждут вашего решения.`,
    provenance: { source: `Агент · ${llm.model} (AITunnel)`, sample: `${facts} фактов из ${ctx.categories.length} категорий`, period: now().slice(0, 10), method: 'Разрывы с бенчмарками и паттерны лидеров → LLM → валидация сервером' }
  })
  return { run, created, skipped, summary }
}

async function runInterpret(userId, cab, interpId, t0) {
  if (!interpId) bad('Укажите interpretation_id')
  const { h, i, ctx } = interpretContext(userId, interpId)
  const llm = await llmChat({ system: INTERPRET_SYSTEM, user: interpretPrompt(ctx), maxTokens: 700, temperature: 0.2 })
  let advice
  try { advice = validateAdvice(extractJson(llm.content)) } catch (e) {
    insertRun(cab.id, 'interpret', interpId, { status: 'error', model: llm.model, tokens_in: llm.tokensIn, tokens_out: llm.tokensOut, cost_rub: llm.cost, duration_ms: Date.now() - t0, error: e.message })
    throw e
  }
  const run = insertRun(cab.id, 'interpret', interpId, {
    model: llm.model, tokens_in: llm.tokensIn, tokens_out: llm.tokensOut, cost_rub: llm.cost,
    duration_ms: Date.now() - t0, created_count: 1, summary: advice.explanation.slice(0, 300)
  })
  const stored = { ...advice, run_id: run.id, model: llm.model, cost_rub: llm.cost, created_at: now() }
  q.run('UPDATE interpretations SET agent_advice=? WHERE id=?', S(stored), i.id)
  logAction(cab.id, 'agent', 'agent_advice', `Совет агента: ${h.title} — ${advice.recommendation === 'scale' ? 'масштабировать' : 'откатить'}`, {
    target: { entity: 'hypothesis', id: h.id, category_id: h.category_id },
    payload: { kind: 'advice', id: i.id },
    note: advice.reason,
    provenance: {
      source: `Агент · ${llm.model} (AITunnel)`,
      sample: `${ctx.test.current_n} наблюдений, вердикт рассчитан сервером`,
      period: now().slice(0, 10),
      method: `Объяснение поверх статистики (z-тест, 95% ДИ). Решение остаётся за вами. ≈${llm.cost.toFixed(2)} ₽`
    }
  })
  return { run, advice: stored, hypothesis_id: h.id }
}
