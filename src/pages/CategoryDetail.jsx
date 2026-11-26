import React, { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, fmtVal, fmtMoney, fmtInt, fmtDate, GROUPS, GROUP_KEYS, CARD_STATUS } from '../api.js'
import { Icon, Chip, StatusChip, Button, Skeleton, EmptyState, Confirm, Tabs, How, AgentBadge, useToast } from '../ui.jsx'
import { BenchmarkScale, Radar, ProfileBars } from '../charts.jsx'
import { useShell } from '../layout.jsx'
import { CategoryForm, BenchmarkForm, PatternForm, EventForm, CardForm } from '../forms.jsx'
import { actionMap, useRefreshAll } from '../hooks.js'
import { AgentRunButton } from '../agent.jsx'

export default function CategoryDetail() {
  const { id } = useParams()
  const { cabinet, requestUndo } = useShell()
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefreshAll(cabinet.id)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'benchmarks'
  const { data, isLoading } = useQuery({ queryKey: ['category', id], queryFn: () => api(`/categories/${id}`) })
  const [form, setForm] = useState(null) // {type, item?}
  const [del, setDel] = useState(null) // {type, item}
  const [delCat, setDelCat] = useState(false)

  const delMut = useMutation({
    mutationFn: ({ type, item }) => api(`/${type}/${item.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Удалено'); refresh([['category', id]]); setDel(null) },
    onError: (e) => { toast(e.message, 'error'); setDel(null) }
  })
  const delCatMut = useMutation({
    mutationFn: () => api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Категория удалена'); refresh(); nav('/categories') },
    onError: (e) => toast(e.message, 'error')
  })

  const amap = useMemo(() => actionMap(data?.actions || []), [data?.actions])

  if (isLoading) return <div className="page"><Skeleton w={300} h={28} /><Skeleton h={120} style={{ marginTop: 16 }} /><Skeleton h={300} style={{ marginTop: 16 }} /></div>
  if (!data) return null
  const { category: c, benchmarks, patterns, events, cards } = data

  const setTab = (t) => setParams({ tab: t }, { replace: true })

  return (
    <div className="page">
      <div className="crumb mb12"><a onClick={() => nav('/categories')} className="clickable">Категории</a><Icon name="chevRight" size={11} /><span>{c.name}</span></div>
      <div className="page-head">
        <div className="flex gap16 aifs">
          <span className="cat-icon" style={{ width: 46, height: 46 }}><Icon name={c.icon || 'box'} size={23} /></span>
          <div>
            <div className="flex aic gap8 wrap"><h1>{c.name}</h1><Chip kind="muted">{c.marketplace}</Chip></div>
            <div className="small bold mt4" style={{ color: 'var(--primary)' }}>{c.thesis}</div>
            <div className="page-sub">{c.description}</div>
          </div>
        </div>
        <div className="flex gap8 aic wrap">
          <AgentRunButton categoryId={id} label="Разобрать разрывы" />
          <Button size="sm" icon="edit" onClick={() => setForm({ type: 'category', item: c })}>Изменить</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={() => setDelCat(true)}>Удалить</Button>
        </div>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'benchmarks', label: 'Бенчмарки', count: benchmarks.length },
        { id: 'patterns', label: 'Паттерны', count: patterns.length },
        { id: 'cards', label: 'Карточки', count: cards.length },
        { id: 'events', label: 'События', count: events.length }
      ]} />

      {tab === 'benchmarks' && <BenchmarksTab benchmarks={benchmarks} onAdd={() => setForm({ type: 'benchmarks' })} onEdit={(item) => setForm({ type: 'benchmarks', item })} onDelete={(item) => setDel({ type: 'benchmarks', item })} />}
      {tab === 'patterns' && <PatternsTab category={c} patterns={patterns} onAdd={() => setForm({ type: 'patterns' })} onEdit={(item) => setForm({ type: 'patterns', item })} onDelete={(item) => setDel({ type: 'patterns', item })} />}
      {tab === 'cards' && <CardsTab cards={cards} benchmarks={benchmarks} patterns={patterns} amap={amap} requestUndo={requestUndo} onAdd={() => setForm({ type: 'cards' })} onEdit={(item) => setForm({ type: 'cards', item })} onDelete={(item) => setDel({ type: 'cards', item })} />}
      {tab === 'events' && <EventsTab events={events} onAdd={() => setForm({ type: 'events' })} onEdit={(item) => setForm({ type: 'events', item })} onDelete={(item) => setDel({ type: 'events', item })} />}

      {form?.type === 'category' && <CategoryForm initial={form.item} cabinetId={cabinet.id} onClose={() => setForm(null)} />}
      {form?.type === 'benchmarks' && <BenchmarkForm initial={form.item} categoryId={id} cabinetId={cabinet.id} onClose={() => setForm(null)} />}
      {form?.type === 'patterns' && <PatternForm initial={form.item} categoryId={id} cabinetId={cabinet.id} onClose={() => setForm(null)} />}
      {form?.type === 'events' && <EventForm initial={form.item} categoryId={id} cabinetId={cabinet.id} onClose={() => setForm(null)} />}
      {form?.type === 'cards' && <CardForm initial={form.item} categoryId={id} cabinetId={cabinet.id} onClose={() => setForm(null)} />}

      <Confirm open={!!del} onClose={() => setDel(null)} title="Удалить?" text={del ? `«${del.item.metric || del.item.title || del.item.name}» будет удалено без возможности восстановления.` : ''} confirmLabel="Удалить" danger loading={delMut.isPending} onConfirm={() => delMut.mutate(del)} />
      <Confirm open={delCat} onClose={() => setDelCat(false)} title={`Удалить «${c.name}»?`} text="Вместе с категорией удалятся бенчмарки, паттерны, события, карточки и связанные гипотезы с тестами." confirmLabel="Удалить" danger loading={delCatMut.isPending} onConfirm={() => delCatMut.mutate()} />
    </div>
  )
}

function BenchmarksTab({ benchmarks, onAdd, onEdit, onDelete }) {
  return (
    <div>
      <div className="flex jcb aic mb12 wrap gap8">
        <div className="legend">
          <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--primary)', opacity: .2, height: 10 }} />коридор нормы p25–p75</span>
          <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--line)', height: 10 }} />распределение категории</span>
          <span className="legend-item"><span className="dot" style={{ background: 'var(--primary)' }} />ваша позиция</span>
        </div>
        <Button size="sm" variant="primary" icon="plus" onClick={onAdd}>Бенчмарк</Button>
      </div>
      {benchmarks.length === 0 && <div className="tile"><EmptyState icon="dashboard" title="Бенчмарков нет" text="Добавьте распределение метрики: шкалу, коридор нормы, уровень лидеров и ваше значение." action={<Button variant="primary" icon="plus" onClick={onAdd}>Добавить бенчмарк</Button>} /></div>}
      <div className="grid g2">
        {benchmarks.map((b) => (
          <div key={b.id} className="tile">
            <div className="tile-head">
              <div className="flex aic gap8">
                <span className="tile-title">{b.metric}</span>
                <StatusChip status={b.status} />
              </div>
              <div className="flex aic gap4">
                <How data={{ source: b.source, sample: `${fmtInt(b.sample)} карточек`, period: b.period, method: b.method }} align="right" />
                <button className="icon-btn" onClick={() => onEdit(b)} title="Изменить"><Icon name="edit" size={13} /></button>
                <button className="icon-btn danger" onClick={() => onDelete(b)} title="Удалить"><Icon name="trash" size={13} /></button>
              </div>
            </div>
            <div style={{ padding: '10px 12px 4px' }}><BenchmarkScale b={b} /></div>
            <div className="flex jcb aic tiny muted num" style={{ padding: '8px 16px 12px' }}>
              <span>вы <b style={{ color: 'var(--primary)' }}>{fmtVal(b.seller, b.unit)}</b></span>
              <span>норма {fmtVal(b.p25, b.unit)}–{fmtVal(b.p75, b.unit)}</span>
              <span>лидеры {fmtVal(b.leader, b.unit)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PatternsTab({ category, patterns, onAdd, onEdit, onDelete }) {
  const grouped = GROUP_KEYS.map((k) => ({ key: k, items: patterns.filter((p) => p.grp === k) })).filter((g) => g.items.length)
  return (
    <div>
      <div className="tile tile-pad mb16">
        <div className="flex gap20 aic wrap">
          <Radar profile={category.profile} size={150} />
          <div className="grow" style={{ minWidth: 240 }}>
            <div className="small bold" style={{ color: 'var(--primary)' }}>Профиль категории: что отличает лидеров</div>
            <div className="tiny muted mb8">{category.thesis}. Высота оси — насколько признак группы решает попадание в топ.</div>
            <ProfileBars profile={category.profile} />
          </div>
          <Button size="sm" variant="primary" icon="plus" onClick={onAdd}>Паттерн</Button>
        </div>
      </div>
      {patterns.length === 0 && <div className="tile"><EmptyState icon="spark" title="Паттернов нет" text="Паттерны — структурированные признаки лидеров: доля видео, схема доставки, ценовые коридоры, роль отзывов." action={<Button variant="primary" icon="plus" onClick={onAdd}>Добавить паттерн</Button>} /></div>}
      {grouped.map((g) => (
        <div key={g.key}>
          <div className="section-title">{GROUPS[g.key]}</div>
          <div className="tile tile-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {g.items.map((p) => (
              <div key={p.id} className="pat-row">
                <div className="grow">
                  <div className="flex aic gap8 wrap">
                    <span className="small bold">{p.title}</span>
                    <span className={`impact ${p.impact}`}>{p.impact}</span>
                  </div>
                  <div className="tiny muted mt4" style={{ maxWidth: 560 }}>{p.detail}</div>
                  <How data={{ source: p.source, sample: `${p.sample} лидеров`, period: p.period, method: p.method }} />
                </div>
                <div className="right" style={{ flexShrink: 0 }}>
                  <div className="tiny muted">у <b className="num" style={{ color: 'var(--primary)' }}>{p.prevalence}%</b> лидеров</div>
                  <div className="prev-track"><div className="prev-fill" style={{ width: `${p.prevalence}%` }} /></div>
                </div>
                <div className="flex gap4">
                  <button className="icon-btn" onClick={() => onEdit(p)} title="Изменить"><Icon name="edit" size={13} /></button>
                  <button className="icon-btn danger" onClick={() => onDelete(p)} title="Удалить"><Icon name="trash" size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CardsTab({ cards, benchmarks, patterns, amap, requestUndo, onAdd, onEdit, onDelete }) {
  const byMetric = (name) => benchmarks.find((b) => b.metric === name)
  const B = {
    price: byMetric('Цена'), ctr: byMetric('CTR карточки'), conv: byMetric('Конверсия в заказ'),
    images: byMetric('Изображений в карточке'), delivery: byMetric('Срок доставки'), rating: byMetric('Рейтинг')
  }
  const videoPattern = patterns.find((p) => p.grp === 'content' && p.title.toLowerCase().includes('видео'))
  const cls = (v, b, corridor = false) => {
    if (!b || v == null) return ''
    if (corridor) return (v < b.p25 || v > b.p75) ? 'cell-warn' : ''
    if (b.higher_better) return v < b.p25 ? 'cell-gap' : v >= b.p90 ? 'cell-lead' : ''
    return v > b.p75 ? 'cell-gap' : v <= b.p10 ? 'cell-lead' : ''
  }
  const norm = (b, key) => b ? fmtVal(b[key], b.unit) : '—'
  return (
    <div>
      <div className="flex jcb aic mb12 wrap gap8">
        <div className="legend">
          <span className="legend-item"><span className="dot" style={{ background: 'var(--danger)' }} />ниже нормы</span>
          <span className="legend-item"><span className="dot" style={{ background: 'var(--warn)' }} />вне коридора</span>
          <span className="legend-item"><span className="dot" style={{ background: 'var(--primary)' }} />уровень лидеров</span>
        </div>
        <Button size="sm" variant="primary" icon="plus" onClick={onAdd}>Артикул</Button>
      </div>
      {cards.length === 0 && <div className="tile"><EmptyState icon="box" title="Артикулов нет" text="Добавьте карточки — каждая строка сравнится с нормой категории по всем ключевым метрикам." action={<Button variant="primary" icon="plus" onClick={onAdd}>Добавить артикул</Button>} /></div>}
      {cards.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Артикул</th><th className="right">Цена</th><th className="right">CTR</th><th className="right">Конверсия</th><th className="right">Заказы 30д</th><th className="right">Изобр.</th><th>Видео</th><th className="right">Доставка</th><th className="right">Рейтинг</th><th>Статус</th><th></th></tr>
            </thead>
            <tbody>
              <tr className="norm-row">
                <td>Норма категории · медиана</td>
                <td className="right num">{norm(B.price, 'p50')}</td>
                <td className="right num">{norm(B.ctr, 'p50')}</td>
                <td className="right num">{norm(B.conv, 'p50')}</td>
                <td className="right">—</td>
                <td className="right num">{norm(B.images, 'p50')}</td>
                <td>{videoPattern ? `у ${videoPattern.prevalence}% лидеров` : '—'}</td>
                <td className="right num">{norm(B.delivery, 'p50')}</td>
                <td className="right num">{norm(B.rating, 'p50')}</td>
                <td></td><td></td>
              </tr>
              {cards.map((card) => {
                const m = card.metrics
                const act = amap[`card:${card.id}`]
                return (
                  <tr key={card.id}>
                    <td>
                      <div className="semi">{card.name}</div>
                      <div className="tiny faint num">{card.sku}</div>
                      {act && <div className="mt4"><AgentBadge action={act} onUndo={requestUndo} /></div>}
                    </td>
                    <td className={`right num ${cls(card.price, B.price, true)}`}>{fmtMoney(card.price)}</td>
                    <td className={`right num ${cls(m.ctr, B.ctr)}`}>{fmtVal(m.ctr, '%')}</td>
                    <td className={`right num ${cls(m.conv, B.conv)}`}>{fmtVal(m.conv, '%')}</td>
                    <td className="right num">{fmtInt(m.orders)}</td>
                    <td className={`right num ${cls(m.images, B.images)}`}>{m.images ?? '—'}</td>
                    <td>{m.video ? <span className="chip ok"><Icon name="video" size={10} />есть</span> : <span className={videoPattern ? 'cell-warn tiny bold' : 'tiny muted'}>нет</span>}</td>
                    <td className={`right num ${cls(m.delivery, B.delivery)}`}>{fmtVal(m.delivery, 'дн')}</td>
                    <td className={`right num ${cls(m.rating, B.rating)}`}>{m.rating ?? '—'}</td>
                    <td>{card.status !== 'active' && <Chip kind={card.status === 'rolled' ? 'ok' : card.status === 'control' ? 'muted' : 'outline'}>{CARD_STATUS[card.status]}</Chip>}</td>
                    <td>
                      <div className="flex gap4">
                        <button className="icon-btn" onClick={() => onEdit(card)} title="Изменить"><Icon name="edit" size={13} /></button>
                        <button className="icon-btn danger" onClick={() => onDelete(card)} title="Удалить"><Icon name="trash" size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function EventsTab({ events, onAdd, onEdit, onDelete }) {
  return (
    <div>
      <div className="flex jcb aic mb12">
        <div className="small muted">Лента событий площадок: что изменилось и повлияло ли на категорию.</div>
        <Button size="sm" variant="primary" icon="plus" onClick={onAdd}>Событие</Button>
      </div>
      {events.length === 0 && <div className="tile"><EmptyState icon="calendar" title="Событий нет" text="Добавляйте изменения площадок: тарифы, формулы ранжирования, акции — с пометкой влияния на категорию." action={<Button variant="primary" icon="plus" onClick={onAdd}>Добавить событие</Button>} /></div>}
      {events.length > 0 && (
        <div className="tile tile-pad">
          <div className="timeline">
            {events.map((e) => (
              <div key={e.id} className={`tl-item ${e.affected ? 'affected' : ''}`}>
                <span className="tl-dot" />
                <div className="flex jcb aifs gap12">
                  <div className="grow">
                    <div className="flex aic gap8 wrap">
                      <span className="tl-date num">{fmtDate(e.date)}</span>
                      <Chip kind="muted">{e.source}</Chip>
                      {e.affected ? <Chip kind="warn">повлияло</Chip> : <Chip kind="muted">без влияния</Chip>}
                    </div>
                    <div className="tl-title">{e.title}</div>
                    {e.note && <div className="tl-note">{e.note}</div>}
                  </div>
                  <div className="flex gap4">
                    <button className="icon-btn" onClick={() => onEdit(e)} title="Изменить"><Icon name="edit" size={13} /></button>
                    <button className="icon-btn danger" onClick={() => onDelete(e)} title="Удалить"><Icon name="trash" size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
