// LLM-клиент: AITunnel (OpenAI-совместимый API). Ключ — только в переменных окружения.
// AITUNNEL_API_KEY      — ключ из кабинета aitunnel.ru
// AITUNNEL_BASE_URL     — по умолчанию https://api.aitunnel.ru/v1
// AITUNNEL_MODEL        — по умолчанию deepseek-v4.1-flash (дёшево и хорошо пишет по-русски)
// AITUNNEL_PRICE_IN/OUT — оценка цены за 1M токенов, ₽ (для журнала, не для биллинга)
import { HttpError } from './util.js'

const KEY = () => (process.env.AITUNNEL_API_KEY || '').trim()
const BASE = () => (process.env.AITUNNEL_BASE_URL || 'https://api.aitunnel.ru/v1').replace(/\/+$/, '')
export const agentModel = () => (process.env.AITUNNEL_MODEL || 'deepseek-v4.1-flash').trim()
export const agentConfigured = () => !!KEY()
const priceIn = () => +(process.env.AITUNNEL_PRICE_IN || 30)
const priceOut = () => +(process.env.AITUNNEL_PRICE_OUT || 120)

export function estimateCost(tokensIn = 0, tokensOut = 0) {
  return +((tokensIn * priceIn() + tokensOut * priceOut()) / 1e6).toFixed(4)
}

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').slice(0, n)

// Один вызов chat/completions с ретраями на сетевые сбои и 5xx/429.
export async function llmChat({ system, user, maxTokens = 1200, temperature = 0.3 }) {
  if (!agentConfigured()) throw new HttpError(400, 'Агент не настроен: добавьте AITUNNEL_API_KEY в переменные окружения сервера')
  const model = agentModel()
  const body = JSON.stringify({
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature,
    stream: false
  })
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt))
    let res
    try {
      res = await fetch(`${BASE()}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` },
        body,
        signal: AbortSignal.timeout(75000)
      })
    } catch {
      lastErr = new HttpError(502, 'AITunnel не отвечает (сеть или таймаут). Попробуйте ещё раз.')
      continue
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'AITunnel отклонил ключ. Проверьте AITUNNEL_API_KEY в переменных окружения.')
    if (res.status === 402) throw new HttpError(502, 'На балансе AITunnel закончились средства. Пополните баланс и повторите.')
    if (res.status === 404) throw new HttpError(502, `Модель «${model}» не найдена в AITunnel. Задайте другую через AITUNNEL_MODEL.`)
    if (res.status === 429 || res.status >= 500) { lastErr = new HttpError(502, `AITunnel временно недоступен (код ${res.status}). Попробуйте ещё раз.`); continue }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new HttpError(502, `Ошибка AITunnel (${res.status}): ${clip(t, 160) || 'без деталей'}`)
    }
    const data = await res.json().catch(() => null)
    const content = data?.choices?.[0]?.message?.content
    if (!content || !String(content).trim()) throw new HttpError(502, 'Модель вернула пустой ответ. Попробуйте ещё раз.')
    const tokensIn = data?.usage?.prompt_tokens || 0
    const tokensOut = data?.usage?.completion_tokens || 0
    return { content: String(content), model: data?.model || model, tokensIn, tokensOut, cost: estimateCost(tokensIn, tokensOut) }
  }
  throw lastErr || new HttpError(502, 'AITunnel недоступен')
}

// Достаём JSON даже если модель обернула его в ```json или добавила текст.
export function extractJson(text) {
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  try { return JSON.parse(s) } catch { throw new HttpError(502, 'Модель вернула ответ не в формате JSON. Попробуйте ещё раз.') }
}
