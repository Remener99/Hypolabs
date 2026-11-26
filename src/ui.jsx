import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { fmtWhen } from './api.js'

// ---------- иконки ----------
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
  flask: <><path d="M9 3h6"/><path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.4 2h12.2a1.5 1.5 0 0 0 1.4-2L14 9V3"/><path d="M7 15h10"/></>,
  journal: <><path d="M4 5h16"/><path d="M4 10h16"/><path d="M4 15h10"/><path d="M4 20h7"/></>,
  activity: <path d="M22 12h-4l-3 8L9 4l-3 8H2"/>,
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  edit: <><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/></>,
  trash: <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
  x: <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  check: <path d="M20 6 9 17l-5-5"/>,
  chevDown: <path d="m6 9 6 6 6-6"/>,
  chevRight: <path d="m9 18 6-6-6-6"/>,
  chevLeft: <path d="m15 18-6-6 6-6"/>,
  undo: <><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>,
  arrowUR: <><path d="M7 17 17 7"/><path d="M8 7h9v9"/></>,
  arrowDR: <><path d="m7 7 10 10"/><path d="M17 8v9H8"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></>,
  menu: <><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></>,
  chair: <><path d="M6 19v2"/><path d="M18 19v2"/><path d="M5 11V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6"/><path d="M4 13a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3Z"/><path d="M8 11V8h8v3"/></>,
  shelf: <><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v6"/><path d="M15 15v6"/></>,
  sofa: <><path d="M5 10V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2"/><path d="M3 13a2 2 0 0 1 4 0v1h10v-1a2 2 0 0 1 4 0v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3Z"/><path d="M6 19v2"/><path d="M18 19v2"/></>,
  video: <><path d="m16 10 6-3v10l-6-3"/><rect x="2" y="6" width="14" height="12" rx="2"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/></>,
  truck: <><path d="M1 4h14v12H1z"/><path d="M15 8h4l4 4v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
  tag: <><path d="M12 2H2v10l9.3 9.3a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8L12 2Z"/><path d="M7 7h.01"/></>,
  star: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2Z"/>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></>,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  play: <path d="m6 4 14 8-14 8V4Z"/>,
  flag: <><path d="M4 22V4a1 1 0 0 1 1-1h9l1 2h5v11h-6l-1-2H6"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  building: <><rect x="4" y="2" width="16" height="20" rx="1.5"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/></>,
  spark: <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19"/>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
  scale: <><path d="M12 3v18"/><path d="M5 7h14"/><path d="m5 7-3 6a3.5 3.5 0 0 0 6 0L5 7Z"/><path d="m19 7-3 6a3.5 3.5 0 0 0 6 0l-3-6Z"/><path d="M8 21h8"/></>,
  wave: <><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M2 18c2-4 4-4 6 0s4 4 6 0 4-4 6 0" opacity=".45"/></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></>,
  rub: <><path d="M8 21V4h6a4.5 4.5 0 0 1 0 9H5"/><path d="M5 17h9"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></>,
  filter: <path d="M22 4H2l8 9v6l4 2v-8l8-9Z"/>,
  dot: <circle cx="12" cy="12" r="4"/>
}
export function Icon({ name, size = 16, strokeWidth = 1.8, style, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
      {PATHS[name] || PATHS.dot}
    </svg>
  )
}
export const CAT_ICONS = { chair: 'chair', shelf: 'shelf', sofa: 'sofa', box: 'box', tag: 'tag', star: 'star' }

// ---------- тосты ----------
const ToastCtx = createContext(null)
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}><Icon name={t.kind === 'error' ? 'alert' : 'check'} size={15} />{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

// ---------- базовые ----------
export function Button({ variant = 'ghost', size, icon, children, className = '', ...rest }) {
  return <button className={`btn ${variant} ${size || ''} ${className}`} {...rest}>{icon && <Icon name={icon} size={size === 'xs' ? 12 : 14} />}{children}</button>
}
export function Chip({ kind = 'muted', children, title }) { return <span className={`chip ${kind}`} title={title}>{children}</span> }
export function StatusChip({ status }) {
  const map = { ok: 'ok', lead: 'lead', gap: 'gap', warn: 'warn' }
  return <Chip kind={map[status.key] || 'muted'}>{status.label}</Chip>
}
export function VerdictChip({ verdict }) {
  if (!verdict) return null
  const map = { confirmed: ['ok', 'Подтверждён'], failed: ['gap', 'Провал'], inconclusive: ['warn', 'Неоднозначно'] }
  const [kind, label] = map[verdict] || ['muted', verdict]
  return <Chip kind={kind}>{label}</Chip>
}
export function HypStatusChip({ status }) {
  const map = { new: ['muted', 'Новая'], accepted: ['outline', 'Принята'], testing: ['ok', 'Тест идёт'], interpreted: ['warn', 'Интерпретация'], scaled: ['lead', 'Масштабируется'], rolled_back: ['muted', 'Откачена'] }
  const [kind, label] = map[status] || ['muted', status]
  return <Chip kind={kind}>{label}</Chip>
}
export function PriorityDot({ p }) {
  const c = p === 'high' ? 'var(--danger)' : p === 'mid' ? 'var(--warn)' : 'var(--faint)'
  const label = p === 'high' ? 'Высокий' : p === 'mid' ? 'Средний' : 'Низкий'
  return <span className="flex aic gap6 tiny muted nowrap"><span className="dot" style={{ background: c }} />{label}</span>
}
export function Skeleton({ w = '100%', h = 14, style }) { return <div className="skeleton" style={{ width: w, height: h, ...style }} /> }
export function EmptyState({ icon = 'box', title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={24} /></div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div className="mt12">{action}</div>}
    </div>
  )
}
export function ProgressBar({ value, warn = false, label }) {
  return (
    <div>
      <div className="progress"><div className={`progress-fill ${warn ? 'warn' : ''}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
      {label && <div className="tiny muted mt4 num">{label}</div>}
    </div>
  )
}

// ---------- модальные ----------
export function Modal({ open, onClose, title, children, foot, wide }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  )
}
export function Confirm({ open, onClose, onConfirm, title, text, confirmLabel = 'Подтвердить', danger, loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading}>{loading ? 'Подождите…' : confirmLabel}</Button></>}>
      <div className="small muted" style={{ lineHeight: 1.55 }}>{text}</div>
    </Modal>
  )
}

// ---------- формы ----------
export function Field({ label, hint, children, full }) {
  return <div className={`field ${full ? 'full' : ''}`}><span className="label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</div>
}
export const Input = (p) => <input className="input" {...p} />
export const Select = (p) => <select className="select" {...p} />
export const Textarea = (p) => <textarea className="textarea" {...p} />

// ---------- вкладки ----------
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count != null && <span className="cnt num">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------- «как получено» ----------
export function How({ data, align = 'left', label = 'как получено' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  if (!data) return null
  return (
    <span className="how-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="how-btn" onClick={() => setOpen(!open)}><Icon name="info" size={12} />{label}</button>
      {open && (
        <div className={`how-pop ${align === 'right' ? 'right' : ''}`}>
          <div className="tiny bold mb8" style={{ color: 'var(--primary)' }}>Как получено</div>
          {data.source && <div className="how-row"><b>Источник</b><span>{data.source}</span></div>}
          {data.sample && <div className="how-row"><b>Выборка</b><span>{data.sample}</span></div>}
          {data.period && <div className="how-row"><b>Период</b><span>{data.period}</span></div>}
          {data.method && <div className="how-row"><b>Метод</b><span>{data.method}</span></div>}
        </div>
      )}
    </span>
  )
}

// ---------- бейдж агента ----------
export function AgentBadge({ action, onUndo }) {
  if (!action) return null
  return (
    <span className={`badge-agent ${action.undone_at ? 'undone' : ''}`} onClick={(e) => e.stopPropagation()}>
      <Icon name={action.actor === 'agent' ? 'spark' : 'user'} size={11} />
      {action.actor === 'agent' ? 'Агент' : 'Вы'} · {fmtWhen(action.created_at)}
      {action.undone_at
        ? <span className="tiny">· откатано</span>
        : action.payload && onUndo && <button className="undo-link" onClick={() => onUndo(action)}><Icon name="undo" size={10} />Откатить</button>}
    </span>
  )
}

// ---------- воронка ----------
export function Funnel({ stage }) {
  const stages = ['Показ', 'Клик', 'Корзина', 'Заказ', 'Выкуп']
  const idx = stages.indexOf(stage)
  return (
    <span className="funnel" title={`Провалена стадия: ${stage}`}>
      {stages.map((s, i) => <span key={s} className={`funnel-seg ${i === idx ? 'fail' : i < idx ? 'pass' : ''}`}>{s}</span>)}
    </span>
  )
}

// ---------- степпер объекта ----------
export function Stepper({ steps, current, failAt }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <div className={`step-line ${i <= current ? 'done' : ''}`} />}
          <div className={`step ${failAt === i ? 'fail' : i < current ? 'done' : i === current ? 'current' : ''}`}>
            <span className="step-dot">{failAt === i ? <Icon name="x" size={10} /> : i < current ? <Icon name="check" size={10} /> : i + 1}</span>
            <span className="step-label">{s}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}
