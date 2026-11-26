import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, GROUPS, GROUP_KEYS, FUNNEL, requiredSample, fmtInt } from './api.js'
import { Modal, Field, Input, Select, Textarea, Button, Icon, useToast } from './ui.jsx'
import { useRefreshAll, useInvalidate } from './hooks.js'

function useSave({ path, method, cabinetId, extraKeys = [], msg }) {
  const toast = useToast()
  const refresh = useRefreshAll(cabinetId)
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body) => api(path, { method, body }),
    onSuccess: () => { toast(msg); refresh(extraKeys); inv(...extraKeys) },
    onError: (e) => toast(e.message, 'error')
  })
}

// ---------- категория ----------
export function CategoryForm({ initial, cabinetId, onClose }) {
  const [f, setF] = useState({
    name: initial?.name || '', marketplace: initial?.marketplace || 'WB', icon: initial?.icon || 'box',
    thesis: initial?.thesis || '', description: initial?.description || '',
    profile: { content: 50, logistics: 50, price: 50, ads: 50, reviews: 50, season: 50, ...Object.fromEntries(Object.entries(initial?.profile || {}).map(([k, v]) => [k, Math.round(v * 100)])) }
  })
  const save = useSave({
    path: initial ? `/categories/${initial.id}` : '/categories', method: initial ? 'PATCH' : 'POST',
    cabinetId, extraKeys: initial ? [['category', initial.id]] : [], msg: initial ? 'Категория обновлена' : 'Категория создана'
  })
  const submit = () => {
    const profile = Object.fromEntries(Object.entries(f.profile).map(([k, v]) => [k, +v / 100]))
    save.mutate({ ...f, cabinet_id: cabinetId, profile }, { onSuccess: onClose })
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Категория' : 'Новая категория'} wide
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit} disabled={!f.name || save.isPending}>{initial ? 'Сохранить' : 'Создать'}</Button></>}>
      <div className="form-grid">
        <Field label="Название" full><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Например, Офисные кресла" /></Field>
        <Field label="Площадка"><Select value={f.marketplace} onChange={(e) => setF({ ...f, marketplace: e.target.value })}><option>WB</option><option>Ozon</option><option>Яндекс Маркет</option></Select></Field>
        <Field label="Значок"><Select value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })}><option value="chair">Кресло</option><option value="shelf">Стеллаж</option><option value="sofa">Диван</option><option value="box">Коробка</option><option value="tag">Ярлык</option><option value="star">Звезда</option></Select></Field>
        <Field label="Что решает в категории" full hint="Короткий вывод: контент, логистика, цена…"><Input value={f.thesis} onChange={(e) => setF({ ...f, thesis: e.target.value })} placeholder="Здесь выигрывает контент" /></Field>
        <Field label="Описание" full><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="full">
          <div className="label mb8">Профиль паттернов — что отличает лидеров</div>
          <div className="form-grid">
            {GROUP_KEYS.map((k) => (
              <Field key={k} label={`${GROUPS[k]} · ${f.profile[k]}`}>
                <input className="range" type="range" min="0" max="100" value={f.profile[k]} onChange={(e) => setF({ ...f, profile: { ...f.profile, [k]: +e.target.value } })} />
              </Field>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ---------- бенчмарк ----------
export function BenchmarkForm({ initial, categoryId, cabinetId, onClose }) {
  const [f, setF] = useState({
    metric: initial?.metric || '', unit: initial?.unit || '%', min: initial?.min ?? '', max: initial?.max ?? '',
    p25: initial?.p25 ?? '', p50: initial?.p50 ?? '', p75: initial?.p75 ?? '', p90: initial?.p90 ?? '',
    leader: initial?.leader ?? '', seller: initial?.seller ?? '', higher_better: initial ? !!initial.higher_better : true,
    sample: initial?.sample ?? 500, period: initial?.period || 'последние 60 дней',
    source: initial?.source || 'Лемма · панель категории', method: initial?.method || 'Перцентили по активным карточкам'
  })
  const save = useSave({
    path: initial ? `/benchmarks/${initial.id}` : '/benchmarks', method: initial ? 'PATCH' : 'POST',
    cabinetId, extraKeys: [['category', categoryId]], msg: initial ? 'Бенчмарк обновлён' : 'Бенчмарк добавлен'
  })
  const num = (v) => v === '' ? null : +v
  const submit = () => save.mutate({
    category_id: categoryId, metric: f.metric, unit: f.unit, min: num(f.min), max: num(f.max),
    p25: num(f.p25), p50: num(f.p50), p75: num(f.p75), p90: num(f.p90), leader: num(f.leader), seller: num(f.seller),
    higher_better: f.higher_better ? 1 : 0, sample: +f.sample, period: f.period, source: f.source, method: f.method
  }, { onSuccess: onClose })
  const valid = f.metric && f.min !== '' && f.max !== '' && f.p25 !== '' && f.p50 !== '' && f.p75 !== ''
  return (
    <Modal open onClose={onClose} title={initial ? 'Бенчмарк' : 'Новый бенчмарк'} wide
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit} disabled={!valid || save.isPending}>{initial ? 'Сохранить' : 'Добавить'}</Button></>}>
      <div className="form-grid">
        <Field label="Метрика"><Input value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} placeholder="Конверсия в заказ" /></Field>
        <Field label="Единица"><Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="%">%</option><option value="₽">₽</option><option value="шт">шт</option><option value="дн">дн</option><option value="">без единицы</option></Select></Field>
        <Field label="Минимум шкалы"><Input type="number" step="any" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <Field label="Максимум шкалы"><Input type="number" step="any" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
        <Field label="p25 — нижняя граница нормы"><Input type="number" step="any" value={f.p25} onChange={(e) => setF({ ...f, p25: e.target.value })} /></Field>
        <Field label="p50 — медиана"><Input type="number" step="any" value={f.p50} onChange={(e) => setF({ ...f, p50: e.target.value })} /></Field>
        <Field label="p75 — верхняя граница нормы"><Input type="number" step="any" value={f.p75} onChange={(e) => setF({ ...f, p75: e.target.value })} /></Field>
        <Field label="p90 — уровень лидеров"><Input type="number" step="any" value={f.p90} onChange={(e) => setF({ ...f, p90: e.target.value })} /></Field>
        <Field label="Значение лидера"><Input type="number" step="any" value={f.leader} onChange={(e) => setF({ ...f, leader: e.target.value })} /></Field>
        <Field label="Ваше значение"><Input type="number" step="any" value={f.seller} onChange={(e) => setF({ ...f, seller: e.target.value })} /></Field>
        <div className="full"><label className="check"><input type="checkbox" checked={f.higher_better} onChange={(e) => setF({ ...f, higher_better: e.target.checked })} />Больше — лучше (для сроков доставки и ДРР — выключить)</label></div>
        <Field label="Выборка, карточек"><Input type="number" value={f.sample} onChange={(e) => setF({ ...f, sample: e.target.value })} /></Field>
        <Field label="Период"><Input value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
        <Field label="Источник" full><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
        <Field label="Метод" full><Input value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

// ---------- паттерн ----------
export function PatternForm({ initial, categoryId, cabinetId, onClose }) {
  const [f, setF] = useState({
    grp: initial?.grp || 'content', title: initial?.title || '', detail: initial?.detail || '',
    prevalence: initial?.prevalence ?? 60, impact: initial?.impact || 'умеренный',
    source: initial?.source || 'Лемма · разбор топ-50', sample: initial?.sample ?? 50,
    period: initial?.period || 'последние 60 дней', method: initial?.method || 'Сравнение частоты признака у лидеров и остальных'
  })
  const save = useSave({
    path: initial ? `/patterns/${initial.id}` : '/patterns', method: initial ? 'PATCH' : 'POST',
    cabinetId, extraKeys: [['category', categoryId]], msg: initial ? 'Паттерн обновлён' : 'Паттерн добавлен'
  })
  return (
    <Modal open onClose={onClose} title={initial ? 'Паттерн' : 'Новый паттерн'} wide
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!f.title || save.isPending} onClick={() => save.mutate({ ...f, category_id: categoryId, prevalence: +f.prevalence, sample: +f.sample }, { onSuccess: onClose })}>{initial ? 'Сохранить' : 'Добавить'}</Button></>}>
      <div className="form-grid">
        <Field label="Группа"><Select value={f.grp} onChange={(e) => setF({ ...f, grp: e.target.value })}>{GROUP_KEYS.map((k) => <option key={k} value={k}>{GROUPS[k]}</option>)}</Select></Field>
        <Field label="Сила признака"><Select value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })}><option>решающий</option><option>сильный</option><option>умеренный</option></Select></Field>
        <Field label="Признак лидеров" full><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Видеообзор 20–40 сек в галерее" /></Field>
        <Field label={`Доля лидеров с признаком, % · ${f.prevalence}`} full><input className="range" type="range" min="0" max="100" value={f.prevalence} onChange={(e) => setF({ ...f, prevalence: e.target.value })} /></Field>
        <Field label="Пояснение" full><Textarea value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
        <Field label="Источник"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
        <Field label="Выборка"><Input type="number" value={f.sample} onChange={(e) => setF({ ...f, sample: e.target.value })} /></Field>
        <Field label="Период"><Input value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
        <Field label="Метод"><Input value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

// ---------- событие ----------
export function EventForm({ initial, categoryId, cabinetId, onClose }) {
  const [f, setF] = useState({
    date: initial?.date || new Date().toISOString().slice(0, 10), title: initial?.title || '',
    source: initial?.source || 'Площадка', affected: initial ? !!initial.affected : true, note: initial?.note || ''
  })
  const save = useSave({
    path: initial ? `/events/${initial.id}` : '/events', method: initial ? 'PATCH' : 'POST',
    cabinetId, extraKeys: [['category', categoryId]], msg: initial ? 'Событие обновлено' : 'Событие добавлено'
  })
  return (
    <Modal open onClose={onClose} title={initial ? 'Событие' : 'Новое событие'}
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!f.title || save.isPending} onClick={() => save.mutate({ ...f, category_id: categoryId }, { onSuccess: onClose })}>{initial ? 'Сохранить' : 'Добавить'}</Button></>}>
      <div className="form-grid">
        <Field label="Дата"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Источник"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
        <Field label="Событие" full><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="WB: изменилась формула ранжирования" /></Field>
        <div className="full"><label className="check"><input type="checkbox" checked={f.affected} onChange={(e) => setF({ ...f, affected: e.target.checked })} />Повлияло на категорию</label></div>
        <Field label="Что это значит" full><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

// ---------- артикул ----------
export function CardForm({ initial, categoryId, cabinetId, onClose }) {
  const m = initial?.metrics || {}
  const [f, setF] = useState({
    name: initial?.name || '', sku: initial?.sku || '', price: initial?.price ?? '', status: initial?.status || 'active',
    ctr: m.ctr ?? '', conv: m.conv ?? '', orders: m.orders ?? '', rating: m.rating ?? '', reviews: m.reviews ?? '',
    images: m.images ?? '', video: !!m.video, delivery: m.delivery ?? '', buyout: m.buyout ?? '', bid: m.bid ?? ''
  })
  const save = useSave({
    path: initial ? `/cards/${initial.id}` : '/cards', method: initial ? 'PATCH' : 'POST',
    cabinetId, extraKeys: [['category', categoryId]], msg: initial ? 'Артикул обновлён' : 'Артикул добавлен'
  })
  const n = (v) => v === '' ? 0 : +v
  const submit = () => save.mutate({
    category_id: categoryId, name: f.name, sku: f.sku || undefined, price: n(f.price), status: f.status,
    metrics: { ctr: n(f.ctr), conv: n(f.conv), orders: n(f.orders), rating: n(f.rating), reviews: n(f.reviews), images: n(f.images), video: f.video ? 1 : 0, delivery: n(f.delivery), buyout: n(f.buyout), bid: n(f.bid) }
  }, { onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={initial ? 'Артикул' : 'Новый артикул'} wide
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!f.name || save.isPending} onClick={submit}>{initial ? 'Сохранить' : 'Добавить'}</Button></>}>
      <div className="form-grid">
        <Field label="Название" full><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Артикул (SKU)"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
        <Field label="Цена, ₽"><Input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="CTR, %"><Input type="number" step="any" value={f.ctr} onChange={(e) => setF({ ...f, ctr: e.target.value })} /></Field>
        <Field label="Конверсия, %"><Input type="number" step="any" value={f.conv} onChange={(e) => setF({ ...f, conv: e.target.value })} /></Field>
        <Field label="Заказы за 30 дней"><Input type="number" value={f.orders} onChange={(e) => setF({ ...f, orders: e.target.value })} /></Field>
        <Field label="Рейтинг"><Input type="number" step="any" value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })} /></Field>
        <Field label="Отзывы"><Input type="number" value={f.reviews} onChange={(e) => setF({ ...f, reviews: e.target.value })} /></Field>
        <Field label="Изображений"><Input type="number" value={f.images} onChange={(e) => setF({ ...f, images: e.target.value })} /></Field>
        <Field label="Доставка, дней"><Input type="number" step="any" value={f.delivery} onChange={(e) => setF({ ...f, delivery: e.target.value })} /></Field>
        <Field label="Выкуп, %"><Input type="number" step="any" value={f.buyout} onChange={(e) => setF({ ...f, buyout: e.target.value })} /></Field>
        <Field label="Ставка, ₽"><Input type="number" step="any" value={f.bid} onChange={(e) => setF({ ...f, bid: e.target.value })} /></Field>
        <Field label="Статус"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Активен</option><option value="test">В тесте</option><option value="rolled">Раскатан</option><option value="control">Контроль</option></Select></Field>
        <div className="full"><label className="check"><input type="checkbox" checked={f.video} onChange={(e) => setF({ ...f, video: e.target.checked })} />Есть видео в галерее</label></div>
      </div>
    </Modal>
  )
}

// ---------- гипотеза ----------
export function HypothesisForm({ initial, cabinetId, categories, defaultCategoryId, onClose }) {
  const [f, setF] = useState({
    category_id: initial?.category_id || defaultCategoryId || categories[0]?.id || '',
    title: initial?.title || '', fact_kind: initial?.fact_kind || 'benchmark', fact_ref: initial?.fact_ref || '',
    fact_text: initial?.fact_text || '', funnel_stage: initial?.funnel_stage || 'Заказ',
    expected_rub: initial?.expected_rub ?? '', priority: initial?.priority || 'mid'
  })
  const { data: dossier } = useQuery({ queryKey: ['category', f.category_id], queryFn: () => api(`/categories/${f.category_id}`), enabled: !!f.category_id })
  const facts = f.fact_kind === 'benchmark' ? (dossier?.benchmarks || []) : (dossier?.patterns || [])
  const save = useSave({
    path: initial ? `/hypotheses/${initial.id}` : '/hypotheses', method: initial ? 'PATCH' : 'POST',
    cabinetId, extraKeys: initial ? [['hypothesis', initial.id]] : [], msg: initial ? 'Гипотеза обновлена' : 'Гипотеза создана'
  })
  const pickFact = (id) => {
    const item = facts.find((x) => x.id === id)
    let text = f.fact_text
    if (item && !f.fact_text) {
      text = f.fact_kind === 'benchmark'
        ? `${item.metric}: у вас ${String(item.seller).replace('.', ',')}${item.unit}, норма категории ${String(item.p25).replace('.', ',')}–${String(item.p75).replace('.', ',')}${item.unit}.`
        : `${item.title} — у ${item.prevalence}% лидеров категории.`
    }
    setF({ ...f, fact_ref: id, fact_text: text })
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Гипотеза' : 'Новая гипотеза'} wide
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!f.title || !f.fact_text || !f.category_id || save.isPending} onClick={() => save.mutate({ ...f, cabinet_id: cabinetId, expected_rub: +f.expected_rub || 0 }, { onSuccess: onClose })}>{initial ? 'Сохранить' : 'Создать'}</Button></>}>
      <div className="form-grid">
        <Field label="Категория"><Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value, fact_ref: '' })} disabled={!!initial}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Стадия воронки"><Select value={f.funnel_stage} onChange={(e) => setF({ ...f, funnel_stage: e.target.value })}>{FUNNEL.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Что меняем" full><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Видеообзор 30 секунд вместо статичной обложки" /></Field>
        <Field label="Тип факта"><Select value={f.fact_kind} onChange={(e) => setF({ ...f, fact_kind: e.target.value, fact_ref: '' })}><option value="benchmark">Бенчмарк</option><option value="pattern">Паттерн</option></Select></Field>
        <Field label="Факт категории"><Select value={f.fact_ref} onChange={(e) => pickFact(e.target.value)}><option value="">Выбрать…</option>{facts.map((x) => <option key={x.id} value={x.id}>{f.fact_kind === 'benchmark' ? x.metric : x.title}</option>)}</Select></Field>
        <Field label="Формулировка факта" full hint="Из какого разрыва выросла гипотеза — числа и норма"><Textarea value={f.fact_text} onChange={(e) => setF({ ...f, fact_text: e.target.value })} /></Field>
        <Field label="Ожидаемый эффект, ₽/мес"><Input type="number" value={f.expected_rub} onChange={(e) => setF({ ...f, expected_rub: e.target.value })} /></Field>
        <Field label="Приоритет"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="high">Высокий</option><option value="mid">Средний</option><option value="low">Низкий</option></Select></Field>
      </div>
    </Modal>
  )
}

// ---------- запись журнала ----------
export function ActionForm({ initial, cabinetId, onClose }) {
  const [f, setF] = useState({ type: initial?.type || 'note', title: initial?.title || '', note: initial?.note || '' })
  const save = useSave({
    path: initial ? `/actions/${initial.id}` : '/actions', method: initial ? 'PATCH' : 'POST',
    cabinetId, msg: initial ? 'Запись обновлена' : 'Запись добавлена'
  })
  return (
    <Modal open onClose={onClose} title={initial ? 'Запись журнала' : 'Новая запись'}
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!f.title || save.isPending} onClick={() => save.mutate({ ...f, cabinet_id: cabinetId }, { onSuccess: onClose })}>{initial ? 'Сохранить' : 'Добавить'}</Button></>}>
      <div className="col gap12">
        <Field label="Тип"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} disabled={!!initial}><option value="note">Запись</option><option value="card_edit">Карточка</option><option value="price">Цена</option><option value="bid">Ставка</option></Select></Field>
        <Field label="Действие"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Что сделано" /></Field>
        <Field label="Комментарий"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

// ---------- принятие гипотезы: расчёт теста ----------
export function AcceptModal({ hypothesis, onClose }) {
  const { data: dossier } = useQuery({ queryKey: ['category', hypothesis.category_id], queryFn: () => api(`/categories/${hypothesis.category_id}`) })
  const convB = dossier?.benchmarks?.find((b) => b.metric.toLowerCase().includes('конверсия'))
  const [f, setF] = useState({ metric: 'Конверсия в заказ', baseline: '', mde: '', days: 14 })
  const baseline = f.baseline === '' ? (convB?.seller ?? 3.5) : +f.baseline
  const mde = f.mde === '' ? Math.max(0.3, +(baseline * 0.14).toFixed(1)) : +f.mde
  const total = useMemo(() => requiredSample(baseline / 100, mde / 100), [baseline, mde])
  const save = useSave({ path: `/hypotheses/${hypothesis.id}/accept`, method: 'POST', cabinetId: hypothesis.cabinet_id, extraKeys: [['hypothesis', hypothesis.id]], msg: 'Гипотеза принята, тест рассчитан' })
  return (
    <Modal open onClose={onClose} title="Принять гипотезу и рассчитать тест"
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ metric: f.metric, baseline, mde, days: +f.days }, { onSuccess: onClose })}>Принять</Button></>}>
      <div className="col gap12">
        <div className="info-box"><Icon name="flask" size={15} /><span>{hypothesis.title}</span></div>
        <div className="form-grid">
          <Field label="Основная метрика"><Input value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} /></Field>
          <Field label="Окно теста, дней"><Input type="number" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
          <Field label={`База, % ${convB ? `(бенчмарк: ${String(convB.seller).replace('.', ',')}%)` : ''}`}><Input type="number" step="any" value={f.baseline} placeholder={String(convB?.seller ?? 3.5)} onChange={(e) => setF({ ...f, baseline: e.target.value })} /></Field>
          <Field label="Минимальный эффект, п.п."><Input type="number" step="any" value={f.mde} placeholder={String(Math.max(0.3, +(baseline * 0.14).toFixed(1)))} onChange={(e) => setF({ ...f, mde: e.target.value })} /></Field>
        </div>
        <div className="stat-grid">
          <div className="stat-cell"><div className="k">Мощность</div><div className="v num">80%</div></div>
          <div className="stat-cell"><div className="k">Значимость</div><div className="v num">α = 0,05</div></div>
          <div className="stat-cell"><div className="k">Нужно наблюдений</div><div className="v num">{fmtInt(total)}</div></div>
        </div>
        <div className="hint">Двухдолевой z-тест: две сопоставимые группы, эффект считаем подтверждённым, если 95% интервал не пересекает ноль.</div>
      </div>
    </Modal>
  )
}

// ---------- параметры теста ----------
export function TestEditModal({ test, hypothesis, onClose }) {
  const [f, setF] = useState({ metric: test.metric, baseline: test.baseline, mde: test.mde, days: test.planned?.days || 14 })
  const total = useMemo(() => requiredSample(+f.baseline / 100, +f.mde / 100), [f.baseline, f.mde])
  const save = useSave({ path: `/tests/${test.id}`, method: 'PATCH', cabinetId: hypothesis.cabinet_id, extraKeys: [['hypothesis', hypothesis.id]], msg: 'Параметры теста обновлены' })
  return (
    <Modal open onClose={onClose} title="Параметры теста"
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ metric: f.metric, baseline: +f.baseline, mde: +f.mde, days: +f.days }, { onSuccess: onClose })}>Сохранить</Button></>}>
      <div className="form-grid">
        <Field label="Метрика" full><Input value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} /></Field>
        <Field label="База, %"><Input type="number" step="any" value={f.baseline} onChange={(e) => setF({ ...f, baseline: e.target.value })} /></Field>
        <Field label="Минимальный эффект, п.п."><Input type="number" step="any" value={f.mde} onChange={(e) => setF({ ...f, mde: e.target.value })} /></Field>
        <Field label="Окно, дней"><Input type="number" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
        <div className="stat-cell"><div className="k">Нужно наблюдений</div><div className="v num">{fmtInt(total)}</div></div>
      </div>
    </Modal>
  )
}

// ---------- масштабирование волнами ----------
export function ScaleModal({ hypothesis, interpretation, cards, onClose }) {
  const used = new Set(hypothesis.card_ids || [])
  const available = cards.filter((c) => !used.has(c.id) && c.status === 'active')
  const [selected, setSelected] = useState(available.map((c) => c.id))
  const [waves, setWaves] = useState(3)
  const controlCount = Math.max(2, Math.round(selected.length * 0.3))
  const managedCount = selected.length - controlCount
  const save = useSave({ path: `/interpretations/${interpretation.id}/decide`, method: 'POST', cabinetId: hypothesis.cabinet_id, extraKeys: [['hypothesis', hypothesis.id], ['category', hypothesis.category_id]], msg: 'Раскатка запущена: волна 1 применена' })
  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])
  return (
    <Modal open onClose={onClose} title="Масштабировать волнами" wide
      foot={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={managedCount < 1 || save.isPending} onClick={() => save.mutate({ decision: 'scale', card_ids: selected, waves: +waves }, { onSuccess: onClose })}>Запустить раскатку</Button></>}>
      <div className="col gap12">
        {interpretation.verdict !== 'confirmed' && (
          <div className="warn-box"><Icon name="alert" size={15} /><span>Эффект не подтверждён полностью — масштабирование на ваш риск. Контрольная группа покажет, сохраняется ли эффект.</span></div>
        )}
        <div className="small muted">Похожие артикулы категории «{hypothesis.category_name || ''}». Последние {controlCount} остаются контролем без изменений.</div>
        <div className="col gap6" style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line-soft)', borderRadius: 10, padding: 10 }}>
          {available.length === 0 && <div className="small muted center" style={{ padding: 12 }}>Нет свободных артикулов — добавьте карточки в категории.</div>}
          {available.map((c, i) => {
            const isControl = selected.includes(c.id) && selected.indexOf(c.id) >= selected.length - controlCount
            return (
              <label key={c.id} className="check jcb" style={{ width: '100%' }}>
                <span className="flex aic gap8"><input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} /><span className="small">{c.name}</span></span>
                {selected.includes(c.id) && (isControl ? <span className="chip muted">контроль</span> : <span className="chip ok">волна {Math.min(+waves, Math.floor(selected.indexOf(c.id) / Math.ceil(managedCount / +waves)) + 1)}</span>)}
              </label>
            )
          })}
        </div>
        <div className="form-grid">
          <Field label="Волн"><Select value={waves} onChange={(e) => setWaves(e.target.value)}><option value={1}>1 — сразу</option><option value={2}>2 — по неделям</option><option value={3}>3 — по неделям</option></Select></Field>
          <div className="stat-cell"><div className="k">Управляемых / контроль</div><div className="v num">{Math.max(0, managedCount)} / {selected.length ? controlCount : 0}</div></div>
        </div>
        <div className="hint">Волна 1 применяется сразу. Каждая следующая — после проверки эффекта предыдущей; контроль сохраняется до конца раскатки.</div>
      </div>
    </Modal>
  )
}
