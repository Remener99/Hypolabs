// Интеграционный тест агентного цикла без реального ключа:
// поднимает mock-сервер LLM (OpenAI-совместимый) и изолированную копию приложения,
// гоняет scan/interpret, журнал, откат, дедупликацию, лимиты и ошибки формата.
import http from 'node:http'
import { spawn } from 'node:child_process'

const APP_PORT = 3401
const MOCK_PORT = 3400
const BASE = `http://127.0.0.1:${APP_PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (m) => console.log('OK:', m)

let mockMode = 'ok'
let mockCalls = 0
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    mockCalls++
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{}') }
    if (!(req.headers.authorization || '').startsWith('Bearer ')) { res.writeHead(401); return res.end('{"error":"no key"}') }
    const payload = JSON.parse(body || '{}')
    const user = payload.messages?.find((m) => m.role === 'user')?.content || ''
    const isScan = user.includes('Задача: найти разрывы')
    let content
    if (mockMode === 'badjson') content = 'Извините, вот вам не JSON.'
    else if (mockMode === 'refuse') content = ''
    else if (isScan) {
      const ctx = JSON.parse(user.split('\n')[1]) // контекст — вторая строка промпта, целиком JSON
      const cats = ctx.categories
      // как настоящая модель: выбираем разрыв, не занятый существующей активной гипотезой
      const pick = (c) => {
        const used = new Set(c.existing_hypotheses.filter((h) => ['new', 'accepted', 'testing'].includes(h.status)).map((h) => h.fact_ref))
        const gaps = c.benchmarks.filter((b) => (b.status.includes('нормы') || b.status.includes('коридора')) && !used.has(b.id))
        return gaps[gaps.length - 1] || c.benchmarks.find((b) => !used.has(b.id)) || c.benchmarks[0]
      }
      const b0 = pick(cats[0])
      const hyps = []
      if (b0) hyps.push({
        category_id: cats[0].id, title: 'Тестовая гипотеза агента: улучшить контент', fact_kind: 'benchmark', fact_ref: b0.id,
        fact_text: `${b0.metric}: у нас ${b0.seller}${b0.unit}, норма ${b0.p25}–${b0.p75}${b0.unit}.`,
        funnel_stage: 'Клик', expected_rub: 50000, priority: 'mid',
        reason: 'Разрыв с нормой категории закрывается паттерном лидеров.', card_ids: cats[0].cards.slice(0, 2).map((c) => c.id)
      })
      if (cats[1]) {
        const b1 = pick(cats[1])
        if (b1) hyps.push({
          category_id: cats[1].id, title: 'Вторая гипотеза агента: логистика', fact_kind: 'benchmark', fact_ref: b1.id,
          fact_text: `${b1.metric}: ${b1.seller} против нормы ${b1.p25}–${b1.p75}.`,
          funnel_stage: 'Заказ', expected_rub: 80000, priority: 'high', reason: 'Лидеры выигрывают за счёт скорости.', card_ids: []
        })
      }
      hyps.push({ category_id: 'no-such-cat', title: 'Гипотеза с несуществующей категорией', fact_kind: 'benchmark', fact_ref: 'x', fact_text: 'мусор', funnel_stage: 'Заказ', expected_rub: 1, priority: 'low', reason: '', card_ids: [] })
      content = JSON.stringify({ summary: `Проверил ${cats.length} категорий, нашёл разрывы.`, hypotheses: hyps })
    } else {
      content = JSON.stringify({
        explanation: 'Основная метрика ухудшилась, доверительный интервал целиком ниже нуля. Контрольные метрики стабильны — эффект реальный.',
        recommendation: 'rollback', reason: 'Провал подтверждён статистически, потери продолжатся при раскатке.', watch: ['CTR', 'Заказы']
      })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      model: payload.model, choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 1800, completion_tokens: 400 }
    }))
  })
})

let child = null
function startApp(env) {
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: { ...process.env, PORT: String(APP_PORT), NODE_ENV: 'production', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stderr.on('data', (d) => { const s = String(d); if (s.includes('Error')) console.error('[app]', s.slice(0, 300)) })
}
async function waitApp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё стартует */ }
    await sleep(250)
  }
  throw new Error('приложение не поднялось')
}
async function stopApp() {
  if (!child) return
  child.kill('SIGTERM')
  await sleep(400)
  if (child.exitCode == null) child.kill('SIGKILL')
  child = null
}

let token = null
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

let failures = 0
const check = (cond, msg) => { if (cond) ok(msg); else { failures++; console.error('ПРОВАЛ:', msg) } }

try {
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r))

  // Чистый сид, чтобы тест был идемпотентным (после прогона — npm run seed)
  await new Promise((resolve, reject) => {
    const s = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/seed.js', '--force'], { stdio: 'ignore' })
    s.on('exit', (code) => code === 0 ? resolve() : reject(new Error('seed failed')))
  })

  // 1. Без ключа агент отключён и понятно об этом говорит
  startApp({ AITUNNEL_API_KEY: '' })
  await waitApp()
  let r = await api('/auth/login', { method: 'POST', body: { email: 'demo@lemma.ru', password: 'lemma2026' } })
  check(r.status === 200, 'вход в демо-кабинет')
  token = r.data.token
  const cab = (await api('/cabinets')).data[0].id
  let cfg = (await api('/agent/config')).data
  check(cfg.configured === false, 'config: агент не настроен без ключа')
  r = await api('/agent/run', { method: 'POST', body: { cabinet_id: cab, mode: 'scan' } })
  check(r.status === 400 && /AITUNNEL_API_KEY/.test(r.data.error), 'запуск без ключа → понятная ошибка 400')
  await stopApp()

  // 2. С ключом и mock-LLM: полный цикл scan
  startApp({ AITUNNEL_API_KEY: 'test-key', AITUNNEL_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`, AITUNNEL_MODEL: 'mock-model' })
  await waitApp()
  r = await api('/auth/login', { method: 'POST', body: { email: 'demo@lemma.ru', password: 'lemma2026' } })
  token = r.data.token
  cfg = (await api('/agent/config')).data
  check(cfg.configured === true && cfg.model === 'mock-model', 'config: агент настроен, модель из env')

  r = await api('/agent/run', { method: 'POST', body: { cabinet_id: cab, mode: 'scan' } })
  check(r.status === 200, 'scan: запуск успешен')
  const scan = r.data
  check(scan.created.length === 2, `scan: создано 2 черновика (получено ${scan.created.length})`)
  check(scan.skipped.some((s) => s.includes('категори')), 'scan: гипотеза с неизвестной категорией отброшена')
  check(scan.run.cost_rub > 0 && scan.run.tokens_in > 0, 'scan: токены и стоимость записаны')

  const hyps = (await api(`/hypotheses?cabinet_id=${cab}`)).data
  const created = hyps.find((h) => h.id === scan.created[0].id)
  check(created?.origin === 'agent' && created?.status === 'new', 'созданная гипотеза: origin=agent, статус new')
  const detail = (await api(`/hypotheses/${created.id}`)).data
  check(detail.hypothesis.agent_reason?.length > 10, 'обоснование агента сохранено')
  check(detail.fact && detail.fact.id === detail.hypothesis.fact_ref, 'факт привязан к реальному бенчмарку')

  const acts = (await api(`/actions?cabinet_id=${cab}`)).data
  const creation = acts.find((a) => a.type === 'hypothesis' && a.actor === 'agent' && a.target.id === created.id)
  check(!!creation?.provenance?.source?.includes('mock-model'), 'журнал: создание с «как получено» (модель)')
  check(acts.some((a) => a.type === 'agent_scan' && a.actor === 'agent'), 'журнал: запись о разборе агента')

  // 3. Дедупликация: повторный scan не плодит дубли (после кулдауна)
  r = await api('/agent/run', { method: 'POST', body: { cabinet_id: cab, mode: 'scan' } })
  check(r.status === 400 && /Подождите/.test(r.data.error), 'кулдаун между запусками работает')
  console.log('…ждём кулдаун 21 с')
  await sleep(21000)
  r = await api('/agent/run', { method: 'POST', body: { cabinet_id: cab, mode: 'scan' } })
  check(r.status === 200 && r.data.created.length === 0, 'повторный scan: дубликаты отброшены')
  check(r.data.skipped.filter((s) => s.includes('уже есть')).length >= 2, 'причина пропуска: такая гипотеза уже есть')

  // 4. Interpret: совет по проваленной гипотезе + откат совета
  console.log('…ждём кулдаун 21 с')
  await sleep(21000)
  const failed = hyps.find((h) => h.verdict === 'failed' && !h.decided)
  const fd = (await api(`/hypotheses/${failed.id}`)).data
  r = await api('/agent/run', { method: 'POST', body: { cabinet_id: cab, mode: 'interpret', interpretation_id: fd.interpretation.id } })
  check(r.status === 200 && r.data.advice.recommendation === 'rollback', 'interpret: совет «откатить» для провала')
  const fd2 = (await api(`/hypotheses/${failed.id}`)).data
  check(fd2.interpretation.agent_advice?.explanation?.length > 20, 'совет сохранён в интерпретации')
  const adviceAct = (await api(`/actions?cabinet_id=${cab}`)).data.find((a) => a.type === 'agent_advice' && !a.undone_at)
  check(!!adviceAct?.payload, 'журнал: совет с payload для отката')
  r = await api(`/actions/${adviceAct.id}/undo`, { method: 'POST' })
  check(r.status === 200, 'откат совета выполнен')
  const fd3 = (await api(`/hypotheses/${failed.id}`)).data
  check(fd3.interpretation.agent_advice == null, 'после отката совет удалён из интерпретации')

  // 5. Битый JSON от модели → ошибка, запуск записан как error
  mockMode = 'badjson'
  console.log('…ждём кулдаун 21 с')
  await sleep(21000)
  r = await api('/agent/run', { method: 'POST', body: { cabinet_id: cab, mode: 'scan' } })
  check(r.status === 502 && /JSON/.test(r.data.error), 'битый JSON → понятная ошибка 502')
  const runs = (await api(`/agent/runs?cabinet_id=${cab}`)).data
  check(runs.some((x) => x.status === 'error'), 'неудачный запуск записан в историю')
  check(runs.filter((x) => x.status === 'ok').length >= 3, 'история успешных запусков на месте')
  cfg = (await api('/agent/config')).data
  check(cfg.month_spent_rub > 0, 'расходы за месяц посчитаны')

  // 6. Пустой ответ модели → ошибка после ретраев
  mockMode = 'refuse'
  console.log('…ждём кулдаун 21 с')
  await sleep(21000)
  const callsBefore = mockCalls
  r = await api('/agent/run', { method: 'POST', body: { cabinet_id: cab, mode: 'scan' } })
  check(r.status === 502 && /пустой ответ/.test(r.data.error), 'пустой ответ → ошибка 502')
  check(mockCalls === callsBefore + 1, `пустой ответ не ретраится: ровно 1 вызов (было ${mockCalls - callsBefore})`)

  // 7. Месячный лимит: перезапуск с бюджетом меньше потраченного
  await stopApp()
  startApp({ AITUNNEL_API_KEY: 'test-key', AITUNNEL_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`, AITUNNEL_MODEL: 'mock-model', AGENT_MONTH_BUDGET_RUB: '0.01' })
  await waitApp()
  r = await api('/auth/login', { method: 'POST', body: { email: 'demo@lemma.ru', password: 'lemma2026' } })
  token = r.data.token
  r = await api('/agent/run', { method: 'POST', body: { cabinet_id: cab, mode: 'scan' } })
  check(r.status === 400 && /Лимит агента/.test(r.data.error), 'месячный лимит защищает баланс')

  console.log(failures ? `\nАГЕНТНЫЙ ТЕСТ ПРОВАЛЕН: ${failures} проверок` : '\nАГЕНТНЫЙ ЦИКЛ ПРОЙДЕН: scan, interpret, журнал, откат, дедупликация, кулдаун, лимиты, ошибки.')
  process.exitCode = failures ? 1 : 0
} catch (e) {
  console.error('АГЕНТНЫЙ ТЕСТ УПАЛ:', e)
  process.exitCode = 1
} finally {
  await stopApp()
  mock.close()
}
