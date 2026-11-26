export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// Хранилище может быть недоступно (third-party iframe, приватный режим) — не роняем приложение
const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
}
let token = store.get('lemma_token') || null
export function setToken(t) {
  token = t
  if (t) store.set('lemma_token', t)
  else store.del('lemma_token')
}
export const safeStore = store

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      // Дублируем токен в кастомный заголовок: некоторые прокси срезают Authorization
      ...(token ? { Authorization: 'Bearer ' + token, 'X-Lemma-Token': token } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      // Централизованный выход только если токен БЫЛ и был отвергнут.
      // Первый /auth/me без токена — это нормальная проверка «не вошли», не логаут.
      setToken(null)
      window.dispatchEvent(new CustomEvent('lemma:unauthorized'))
    }
    throw new ApiError(res.status, data?.error || 'Ошибка запроса')
  }
  return data
}

// ---------- форматирование ----------
const ru = (n) => Math.round(n).toLocaleString('ru-RU')
export function fmtMoney(n, { compact = false } = {}) {
  if (n == null || isNaN(n)) return '—'
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (compact && a >= 1e6) return `${sign}${(a / 1e6).toFixed(2).replace('.', ',')} млн ₽`
  if (compact && a >= 1e4) return `${sign}${ru(a / 1e3)} тыс ₽`
  return `${sign}${ru(a)} ₽`
}
export const fmtInt = (n) => (n == null ? '—' : ru(n))
export function fmtVal(v, unit) {
  if (v == null || isNaN(v)) return '—'
  if (unit === '₽') return fmtMoney(v)
  const n = typeof v === 'number' ? +v.toFixed(2) : v
  if (unit === '%') return `${String(n).replace('.', ',')}%`
  if (unit === 'дн') return `${String(n).replace('.', ',')} дн`
  if (unit === 'шт') return ru(v)
  return String(n).replace('.', ',')
}
export const fmtPct = (v) => `${String(v).replace('.', ',')}%`
export const fmtDelta = (v, unit = '%') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${String(Math.abs(v)).replace('.', ',')}${unit === 'п.п.' ? ' п.п.' : unit === '%' ? '%' : ''}`

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}
export function fmtDateShort(iso) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function fmtTime(iso) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export function fmtWhen(iso) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const that = new Date(d); that.setHours(0, 0, 0, 0)
  const diff = Math.round((today - that) / 86400000)
  if (diff === 0) return `сегодня, ${fmtTime(iso)}`
  if (diff === 1) return `вчера, ${fmtTime(iso)}`
  return `${fmtDate(iso)}, ${fmtTime(iso)}`
}
export function dayKey(iso) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const that = new Date(d); that.setHours(0, 0, 0, 0)
  const diff = Math.round((today - that) / 86400000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  return fmtDate(iso)
}

// ---------- словари ----------
export const STATUS_LABEL = { new: 'Новая', accepted: 'Принята', testing: 'Тест идёт', interpreted: 'Интерпретация', scaled: 'Масштабируется', rolled_back: 'Откачена' }
export const VERDICT_LABEL = { confirmed: 'Подтверждён', failed: 'Провал', inconclusive: 'Неоднозначно' }
export const PRIORITY_LABEL = { high: 'Высокий', mid: 'Средний', low: 'Низкий' }
export const FUNNEL = ['Показ', 'Клик', 'Корзина', 'Заказ', 'Выкуп']
export const GROUPS = { content: 'Контент', logistics: 'Логистика', price: 'Цена', ads: 'Реклама', reviews: 'Отзывы', season: 'Сезонность' }
export const GROUP_KEYS = ['content', 'logistics', 'price', 'ads', 'reviews', 'season']
export const ACTION_TYPE_LABEL = {
  card_edit: 'Карточка', price: 'Цена', bid: 'Ставка', test_start: 'Запуск теста', wave: 'Раскатка',
  hypothesis: 'Гипотеза', accept: 'Принятие', decide: 'Решение', interpretation: 'Интерпретация',
  benchmark: 'Бенчмарк', category: 'Категория', rollback: 'Откат', note: 'Запись', test: 'Тест'
}
export const CARD_STATUS = { active: 'Активен', rolled: 'Раскатан', control: 'Контроль', test: 'В тесте' }

// Требуемая выборка (та же формула, что на сервере) — для превью в форме
export function requiredSample(p1, mdeAbs) {
  const p2 = Math.min(0.95, Math.max(0.001, p1 + mdeAbs))
  const n = Math.ceil(((1.959964 + 0.841621) ** 2) * (p1 * (1 - p1) + p2 * (1 - p2)) / ((p2 - p1) ** 2))
  return n * 2
}
