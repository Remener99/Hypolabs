import React, { useMemo, useRef, useState } from 'react'
import { fmtVal, fmtInt, GROUPS, GROUP_KEYS } from './api.js'
import { Icon } from './ui.jsx'

const P = '#2F4F4F', LINE = '#DCDCDC', FAINT = '#A5A5A2', WARN = '#A8823F', DANGER = '#A65A4E'

// ---------- спарклайн ----------
export function Sparkline({ data = [], width = 150, height = 38, color = P }) {
  if (!data.length) return null
  const min = Math.min(...data), max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (width - 4) + 2, height - 4 - ((v - min) / span) * (height - 10)])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`
  const last = pts[pts.length - 1]
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <path d={area} fill={color} opacity=".08" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  )
}

// ---------- шкала бенчмарка: распределение + позиция селлера ----------
export function BenchmarkScale({ b, compact = false }) {
  const W = 600, H = compact ? 118 : 132
  const x0 = 24, x1 = W - 24
  const sx = (v) => x0 + ((Math.min(Math.max(v, b.min), b.max) - b.min) / (b.max - b.min || 1)) * (x1 - x0)
  const axisY = compact ? 84 : 96
  const topY = compact ? 34 : 42
  const bins = b.bins || []
  const bw = (x1 - x0) / bins.length
  const sellerX = sx(b.seller)
  const leaderX = sx(b.leader ?? b.p90)
  const out = b.seller < b.p25 || b.seller > b.p75
  const flagColor = out ? (b.status?.key === 'gap' ? DANGER : WARN) : P
  const flagW = 92
  const flagX = Math.min(Math.max(sellerX - flagW / 2, x0), x1 - flagW)
  const ticks = useMemo(() => {
    const n = 5
    return Array.from({ length: n }, (_, i) => b.min + (i / (n - 1)) * (b.max - b.min))
  }, [b.min, b.max])
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* коридор нормы */}
      <rect x={sx(b.p25)} y={topY - 6} width={Math.max(0, sx(b.p75) - sx(b.p25))} height={axisY - topY + 6} fill={P} opacity=".07" rx="3" />
      {/* гистограмма */}
      {bins.map((h, i) => (
        <rect key={i} x={x0 + i * bw + 1} y={axisY - h * (axisY - topY)} width={bw - 2} height={h * (axisY - topY)} fill={LINE} rx="1.5" />
      ))}
      {/* медиана */}
      <line x1={sx(b.p50)} x2={sx(b.p50)} y1={topY - 6} y2={axisY} stroke={P} strokeWidth="1.2" strokeDasharray="3 3" opacity=".55" />
      {/* ось */}
      <line x1={x0} x2={x1} y1={axisY} y2={axisY} stroke={LINE} strokeWidth="1.5" />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={sx(t)} x2={sx(t)} y1={axisY} y2={axisY + 4} stroke={FAINT} strokeWidth="1" />
          <text x={sx(t)} y={axisY + 16} textAnchor="middle" fontSize="9.5" fill={FAINT}>{fmtVal(Math.round(t * 10) / 10, b.unit)}</text>
        </g>
      ))}
      {/* лидеры */}
      <g>
        <path d={`M${leaderX - 4.5},${topY - 12} L${leaderX + 4.5},${topY - 12} L${leaderX},${topY - 5} Z`} fill={FAINT} />
        <text x={Math.min(Math.max(leaderX, x0 + 30), x1 - 30)} y={topY - 17} textAnchor="middle" fontSize="9" fill={FAINT}>лидеры</text>
      </g>
      {/* селлер */}
      <line x1={sellerX} x2={sellerX} y1={22} y2={axisY} stroke={flagColor} strokeWidth="1.8" />
      <circle cx={sellerX} cy={axisY} r="3.6" fill={flagColor} />
      <g>
        <rect x={flagX} y={4} width={flagW} height={18} rx="5" fill={flagColor} />
        <text x={flagX + flagW / 2} y={16.5} textAnchor="middle" fontSize="10" fontWeight="650" fill="#fff">вы · {fmtVal(b.seller, b.unit)}</text>
      </g>
      {!compact && (
        <text x={sx(b.p50)} y={H - 2} textAnchor="middle" fontSize="9.5" fill={P} opacity=".8">медиана {fmtVal(b.p50, b.unit)} · норма {fmtVal(b.p25, b.unit)}–{fmtVal(b.p75, b.unit)}</text>
      )}
    </svg>
  )
}

// ---------- радар профиля категории ----------
export function Radar({ profile = {}, size = 150, labels = true, color = P }) {
  const cx = size / 2, cy = size / 2
  const R = size / 2 - (labels ? 26 : 6)
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 6
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  }
  const ring = (f) => GROUP_KEYS.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(',')).join(' ')
  const vals = GROUP_KEYS.map((k) => profile[k] ?? 0.5)
  const poly = vals.map((v, i) => pt(i, R * Math.max(0.06, v)).map((x) => x.toFixed(1)).join(',')).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', flexShrink: 0 }}>
      {[0.33, 0.66, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke={LINE} strokeWidth="1" />)}
      {GROUP_KEYS.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={LINE} strokeWidth="1" /> })}
      <polygon points={poly} fill={color} opacity=".14" />
      <polygon points={poly} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      {vals.map((v, i) => { const [x, y] = pt(i, R * Math.max(0.06, v)); return <circle key={i} cx={x} cy={y} r="2.4" fill={color} /> })}
      {labels && GROUP_KEYS.map((k, i) => {
        const [x, y] = pt(i, R + 15)
        return <text key={k} x={x} y={y + 3} textAnchor="middle" fontSize="9.5" fill="#7C7C7A" fontWeight="550">{GROUPS[k]}</text>
      })}
    </svg>
  )
}

// ---------- профиль паттернов: бары ----------
export function ProfileBars({ profile = {}, dense = false }) {
  return (
    <div className="col" style={{ gap: dense ? 2 : 4 }}>
      {GROUP_KEYS.map((k) => {
        const v = profile[k] ?? 0.5
        return (
          <div className="profile-row" key={k}>
            <span className="profile-label" style={dense ? { width: 74, fontSize: 11 } : undefined}>{GROUPS[k]}</span>
            <div className="profile-track"><div className="profile-fill" style={{ width: `${v * 100}%`, opacity: 0.35 + v * 0.65 }} /></div>
            {!dense && <span className="tiny muted num" style={{ width: 30, textAlign: 'right' }}>{Math.round(v * 100)}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ---------- линии: управляемые против контроля ----------
export function LinesChart({ labels = [], series = [], height = 210, unit = '' }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)
  const W = 640, H = height, L = 40, Rm = 12, T = 14, B = 24
  const all = series.flatMap((s) => s.data)
  if (!all.length) return null
  let min = Math.min(...all), max = Math.max(...all)
  const pad = (max - min) * 0.15 || 1
  min -= pad; max += pad
  const n = labels.length
  const sx = (i) => L + (i / Math.max(1, n - 1)) * (W - L - Rm)
  const sy = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B)
  const yTicks = [0, 1, 2, 3].map((i) => min + (i / 3) * (max - min))
  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((relX - L) / (W - L - Rm)) * (n - 1))
    if (i >= 0 && i < n) setHover({ i, px: (sx(i) / W) * rect.width })
    else setHover(null)
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - Rm} y1={sy(t)} y2={sy(t)} stroke={LINE} strokeWidth="1" strokeDasharray={i === 0 ? '' : '2 4'} />
            <text x={L - 6} y={sy(t) + 3} textAnchor="end" fontSize="9.5" fill={FAINT}>{Math.round(t * 10) / 10}</text>
          </g>
        ))}
        {labels.map((l, i) => (n <= 9 || i % 2 === 0) && (
          <text key={i} x={sx(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill={FAINT}>{l}</text>
        ))}
        {series.map((s) => {
          const d = s.data.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
          return <path key={s.name} d={d} fill="none" stroke={s.color || P} strokeWidth="2" strokeDasharray={s.dash || ''} strokeLinejoin="round" strokeLinecap="round" />
        })}
        {hover && <line x1={sx(hover.i)} x2={sx(hover.i)} y1={T} y2={H - B} stroke={FAINT} strokeWidth="1" strokeDasharray="3 3" />}
        {hover && series.map((s) => <circle key={s.name} cx={sx(hover.i)} cy={sy(s.data[hover.i])} r="3.4" fill={s.color || P} stroke="#fff" strokeWidth="1.5" />)}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: hover.px, top: 8 }}>
          <b>{labels[hover.i]}</b>
          {series.map((s) => <div key={s.name}>{s.name}: <b className="num">{s.data[hover.i]}{unit}</b></div>)}
        </div>
      )}
    </div>
  )
}

// ---------- эффект с доверительным интервалом ----------
export function EffectCI({ effect }) {
  const W = 300, H = 34, cy = 17
  const m = Math.max(Math.abs(effect.ci[0]), Math.abs(effect.ci[1]), Math.abs(effect.delta)) * 1.3 || 1
  const sx = (v) => 10 + ((v + m) / (2 * m)) * (W - 20)
  const positive = effect.delta >= 0
  const color = effect.primary ? (positive ? P : DANGER) : FAINT
  const crosses = effect.ci[0] <= 0 && effect.ci[1] >= 0
  return (
    <div className="flex aic gap12" style={{ padding: '5px 0' }}>
      <div style={{ width: 170, flexShrink: 0 }}>
        <div className="small semi">{effect.metric}{effect.primary && <span className="tiny faint"> · основная</span>}</div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: 320 }}>
        <line x1={sx(0)} x2={sx(0)} y1={4} y2={H - 4} stroke={FAINT} strokeWidth="1.2" strokeDasharray="2 3" />
        <rect x={sx(effect.ci[0])} y={cy - 4.5} width={Math.max(2, sx(effect.ci[1]) - sx(effect.ci[0]))} height={9} rx="4.5" fill={color} opacity={crosses ? 0.18 : 0.28} />
        <line x1={sx(effect.ci[0])} x2={sx(effect.ci[1])} y1={cy} y2={cy} stroke={color} strokeWidth="1.4" />
        <circle cx={sx(effect.delta)} cy={cy} r="4.4" fill={color} />
        <text x={sx(0)} y={H - 1} textAnchor="middle" fontSize="8.5" fill={FAINT}>0</text>
      </svg>
      <div className="num nowrap right" style={{ width: 150, flexShrink: 0 }}>
        <span className="bold" style={{ color }}>{effect.delta > 0 ? '+' : ''}{String(effect.delta).replace('.', ',')}{effect.unit === 'п.п.' ? ' п.п.' : effect.unit}</span>
        <span className="tiny faint"> [{String(effect.ci[0]).replace('.', ',')}; {String(effect.ci[1]).replace('.', ',')}]</span>
      </div>
    </div>
  )
}

// ---------- волны раскатки ----------
export function WaveTrack({ waves = [], controlCount = 0 }) {
  return (
    <div className="col gap12">
      <div className="wave-chips">
        {waves.map((w) => (
          <div key={w.n} className={`wave-chip ${w.status}`}>
            <span className="wave-n">
              {w.status === 'done' && <Icon name="check" size={11} />}
              {w.status === 'rolled_back' && <Icon name="undo" size={11} />}
              Волна {w.n}
            </span>
            <span className="tiny muted num">{w.card_ids.length} арт. · {w.date ? w.date.slice(5).split('-').reverse().join('.') : '—'}</span>
            <span className="tiny" style={{ color: w.status === 'done' ? P : w.status === 'rolled_back' ? DANGER : FAINT }}>
              {w.status === 'done' ? 'Раскатана' : w.status === 'rolled_back' ? 'Откачена' : 'Ожидает'}
            </span>
          </div>
        ))}
        <div className="wave-chip" style={{ borderStyle: 'dashed' }}>
          <span className="wave-n" style={{ color: 'var(--muted)' }}><Icon name="eye" size={11} />Контроль</span>
          <span className="tiny muted num">{controlCount} арт.</span>
          <span className="tiny faint">Без изменений</span>
        </div>
      </div>
      <div className="flex aic gap12 wrap">
        <div className="card-dots">
          {waves.flatMap((w) => w.card_ids.map((id) => <span key={id} className={`card-dot ${w.status === 'pending' ? 'pending' : w.status === 'rolled_back' ? 'pending' : ''}`} title={`Артикул ${id}`} />))}
          {Array.from({ length: controlCount }, (_, i) => <span key={`c${i}`} className="card-dot control" />)}
        </div>
        <div className="legend">
          <span className="legend-item"><span className="card-dot" /> управляемые</span>
          <span className="legend-item"><span className="card-dot pending" /> ожидают</span>
          <span className="legend-item"><span className="card-dot control" /> контроль</span>
        </div>
      </div>
    </div>
  )
}

// ---------- до / после ----------
export function BeforeAfter({ rows = [] }) {
  return (
    <table className="tbl" style={{ fontSize: 12.5 }}>
      <thead><tr><th>Контрольная метрика</th><th className="right">До</th><th className="right">После</th><th className="right">Δ</th><th></th></tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const d = r.after - r.before
          const dp = r.before ? (d / r.before) * 100 : 0
          return (
            <tr key={i}>
              <td className="semi">{r.metric}</td>
              <td className="right num">{fmtVal(r.before, r.unit)}</td>
              <td className="right num">{fmtVal(r.after, r.unit)}</td>
              <td className="right num muted">{d === 0 ? '0' : `${d > 0 ? '+' : '−'}${fmtVal(Math.abs(d), r.unit)}`}</td>
              <td className="right">{r.ok ? <span className="chip ok"><Icon name="check" size={10} />стабильно</span> : <span className="chip warn">сдвиг</span>}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
