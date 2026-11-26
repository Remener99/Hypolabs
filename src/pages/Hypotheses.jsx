import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, fmtMoney } from '../api.js'
import { Icon, Chip, Button, Skeleton, EmptyState, Confirm, Tabs, HypStatusChip, VerdictChip, PriorityDot, Funnel, useToast } from '../ui.jsx'
import { useShell } from '../layout.jsx'
import { HypothesisForm } from '../forms.jsx'
import { useRefreshAll } from '../hooks.js'

const STAGE_IDX = { new: 1, accepted: 2, testing: 2, interpreted: 3, scaled: 5, rolled_back: 5 }

export function MiniSteps({ status, verdict }) {
  const idx = STAGE_IDX[status] ?? 0
  return (
    <span className="mini-steps" title="Факт → Гипотеза → Тест → Интерпретация → Решение">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`mini-step ${verdict === 'failed' && i === 3 && status === 'interpreted' ? 'fail' : i < idx ? 'done' : ''}`} />
      ))}
    </span>
  )
}

export default function Hypotheses() {
  const { cabinet } = useShell()
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefreshAll(cabinet.id)
  const { data: hyps = [], isLoading } = useQuery({ queryKey: ['hypotheses', cabinet.id], queryFn: () => api(`/hypotheses?cabinet_id=${cabinet.id}`) })
  const { data: cats = [] } = useQuery({ queryKey: ['categories', cabinet.id], queryFn: () => api(`/categories?cabinet_id=${cabinet.id}`) })
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(null)
  const [del, setDel] = useState(null)
  const delMut = useMutation({
    mutationFn: (id) => api(`/hypotheses/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Гипотеза удалена'); refresh(); setDel(null) },
    onError: (e) => { toast(e.message, 'error'); setDel(null) }
  })

  const match = (h) => filter === 'all' || (filter === 'decided' ? ['scaled', 'rolled_back'].includes(h.status) : h.status === filter)
  const list = hyps.filter(match)
  const count = (f) => f === 'all' ? hyps.length : f === 'decided' ? hyps.filter((h) => ['scaled', 'rolled_back'].includes(h.status)).length : hyps.filter((h) => h.status === f).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Гипотезы</h1>
          <div className="page-sub">Один связанный объект: факт категории → гипотеза → тест → интерпретация → откат или масштабирование.</div>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setForm({})} disabled={!cats.length}>Новая гипотеза</Button>
      </div>

      <Tabs active={filter} onChange={setFilter} tabs={[
        { id: 'all', label: 'Все', count: count('all') },
        { id: 'new', label: 'Новые', count: count('new') },
        { id: 'accepted', label: 'Принятые', count: count('accepted') },
        { id: 'testing', label: 'Тесты', count: count('testing') },
        { id: 'interpreted', label: 'Интерпретация', count: count('interpreted') },
        { id: 'decided', label: 'Решено', count: count('decided') }
      ]} />

      {isLoading && <div className="col gap12">{[1, 2, 3].map((i) => <Skeleton key={i} h={92} />)}</div>}

      {!isLoading && list.length === 0 && (
        <div className="tile">
          <EmptyState icon="flask" title={filter === 'all' ? 'Гипотез пока нет' : 'В этой стадии пусто'}
            text={filter === 'all' ? 'Гипотеза рождается из конкретного разрыва между вашей карточкой и бенчмарком категории. Создайте первую — или откройте категорию и посмотрите, где вы выпали из нормы.' : 'Объекты попадают сюда по мере прохождения цепочки.'}
            action={filter === 'all' && cats.length > 0 ? <Button variant="primary" icon="plus" onClick={() => setForm({})}>Создать гипотезу</Button> : null} />
        </div>
      )}

      {list.length > 0 && (
        <div className="tile">
          {list.map((h) => (
            <div key={h.id} className="hyp-row" onClick={() => nav(`/hypotheses/${h.id}`)}>
              <div className="grow">
                <div className="flex aic gap8 wrap">
                  <span className="hyp-title">{h.title}</span>
                  {h.origin === 'agent' && <span className="badge-agent"><Icon name="spark" size={10} />агент</span>}
                  <VerdictChip verdict={h.verdict} />
                </div>
                <div className="hyp-fact">{h.fact_text}</div>
                <div className="flex aic gap12 mt8 wrap">
                  <Chip kind="muted">{h.category_name}</Chip>
                  <Funnel stage={h.funnel_stage} />
                </div>
              </div>
              <div className="hyp-side">
                <div className="flex aic gap8"><MiniSteps status={h.status} verdict={h.verdict} /><HypStatusChip status={h.status} /></div>
                <span className="small bold num" style={{ color: 'var(--primary)' }}>+{fmtMoney(h.expected_rub, { compact: true })}/мес</span>
                <div className="flex aic gap8">
                  <PriorityDot p={h.priority} />
                  <button className="icon-btn" title="Изменить" onClick={(e) => { e.stopPropagation(); setForm({ item: h }) }}><Icon name="edit" size={13} /></button>
                  <button className="icon-btn danger" title="Удалить" onClick={(e) => { e.stopPropagation(); setDel(h) }}><Icon name="trash" size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && <HypothesisForm initial={form.item} cabinetId={cabinet.id} categories={cats} onClose={() => setForm(null)} />}
      <Confirm open={!!del} onClose={() => setDel(null)} title="Удалить гипотезу?" text={del ? `«${del.title}» и связанные тест, интерпретация и раскатка будут удалены.` : ''} confirmLabel="Удалить" danger loading={delMut.isPending} onConfirm={() => delMut.mutate(del.id)} />
    </div>
  )
}
