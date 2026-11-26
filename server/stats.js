// Статистика: мощность двухдолевого z-теста и генерация распределений

// Статус бенчмарка: где продавец относительно нормы категории
export function benchStatus(b) {
  const corridor = b.unit === '₽'
  if (b.seller >= b.p25 && b.seller <= b.p75) return { key: 'ok', label: 'В норме' }
  if (corridor) return b.seller < b.p25 ? { key: 'warn', label: 'Ниже коридора' } : { key: 'warn', label: 'Выше коридора' }
  const below = b.seller < b.p25
  const good = b.higher_better ? !below : below
  if (b.seller >= b.p90 && b.higher_better) return { key: 'lead', label: 'Уровень лидеров' }
  if (b.seller <= b.p10 && !b.higher_better) return { key: 'lead', label: 'Уровень лидеров' }
  return good ? { key: 'ok', label: 'В норме' } : { key: 'gap', label: below ? 'Ниже нормы' : 'Выше нормы' }
}
export function requiredSample(p1, mdeAbs, alpha = 0.05, power = 0.8) {
  const p2 = Math.min(0.95, Math.max(0.001, p1 + mdeAbs))
  const zA = 1.959964 // alpha 0.05, two-sided
  const zB = power >= 0.9 ? 1.281552 : 0.841621 // 0.8 / 0.9
  const n = Math.ceil(((zA + zB) ** 2) * (p1 * (1 - p1) + p2 * (1 - p2)) / ((p2 - p1) ** 2))
  return { perGroup: n, total: n * 2 }
}

// Гистограмма по перцентилям: плотность с лёгким правым хвостом
export function binsFromQuantiles(min, max, p25, p50, p75, n = 26) {
  const sigma = Math.max((p75 - p25) / 1.349, (max - min) / 14)
  const bins = []
  let peak = 0
  for (let i = 0; i < n; i++) {
    const x = min + ((i + 0.5) / n) * (max - min)
    let h = Math.exp(-((x - p50) ** 2) / (2 * sigma * sigma))
    h += 0.18 * Math.exp(-((x - p75) ** 2) / (2 * (sigma * 1.7) ** 2))
    peak = Math.max(peak, h)
    bins.push(h)
  }
  return bins.map((h) => +(h / peak).toFixed(3))
}

export function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export function addDays(iso, days) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

// Индексная серия «управляемые против контроля» для раскатки
export function rolloutSeries(wavesDone, effectPct, weeks = 8) {
  const labels = [], managed = [], control = []
  const today = new Date()
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i * 7)
    labels.push(d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }))
    const wave = Math.min(wavesDone, Math.max(0, Math.floor((weeks - 1 - i - 1) / 2) + 1))
    const ramp = wavesDone === 0 ? 0 : Math.min(1, (wave / Math.max(1, wavesDone)))
    const noiseC = [0.8, -0.6, 1.1, -0.9, 0.4, -0.3, 0.7, 0.2][i % 8]
    const noiseM = [0.5, -0.4, 0.9, -0.5, 0.6, 0.1, 0.8, 0.3][i % 8]
    control.push(+(100 + noiseC).toFixed(1))
    managed.push(+(100 + effectPct * ramp * ((weeks - 1 - i) / (weeks - 1)) + noiseM).toFixed(1))
  }
  return { labels, managed, control }
}
