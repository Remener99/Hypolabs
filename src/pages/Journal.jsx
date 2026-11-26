import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, fmtWhen, dayKey, ACTION_TYPE_LABEL } from '../api.js'
import { Icon, Chip, Button, Skeleton, EmptyState, Confirm, How, Select, Input, useToast } from '../ui.jsx'
import { useShell } from '../layout.jsx'
import { ActionForm } from '../forms.jsx'
import { actionLink, useRefreshAll } from '../hooks.js'

const TYPE_ICON = {
  card_edit: 'image', price: 'tag', bid: 'target', test_start: 'play', wave: 'wave',
  hypothesis: 'flask', accept: 'check', decide: 'flag', interpretation: 'scale',
  benchmark: 'dashboard', category: 'layers', rollback: 'undo', note: 'journal', test: 'flask'
}

export default function Journal() {
  const { cabinet, requestUndo } = useShell()
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefreshAll(cabinet.id)
  const { data: actions = [], isLoading } = useQuery({ queryKey: ['actions', cabinet.id], queryFn: () => api(`/actions?cabinet_id=${cabinet.id}`) })
  const [actor, setActor] = useState('all')
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(null)
  const [del, setDel] = useState(null)
  const delMut = useMutation({
    mutationFn: (id) => api(`/actions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Запись удалена'); refresh(); setDel(null) },
    onError: (e) => { toast(e.message, 'error'); setDel(null) }
  })

  const list = useMemo(() => actions.filter((a) =>
    (actor === 'all' || a.actor === actor) &&
    (type === 'all' || a.type === type) &&
    (!search || (a.title + ' ' + (a.note || '')).toLowerCase().includes(search.toLowerCase()))
  ), [actions, actor, type, search])

  const groups = useMemo(() => {
    const g = []
    for (const a of list) {
      const k = dayKey(a.created_at)
      const last = g[g.length - 1]
      if (last && last.label === k) last.items.push(a)
      else g.push({ label: k, items: [a] })
    }
    return g
  }, [list])

  const types = [...new Set(actions.map((a) => a.type))]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Журнал действий</h1>
          <div className="page-sub">Всё, что меняли агент и вы: карточки, ставки, цены, тесты, волны. Любое изменение можно откатить.</div>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setForm({})}>Запись</Button>
      </div>

      <div className="flex gap8 mb16 wrap">
        <Select value={actor} onChange={(e) => setActor(e.target.value)} style={{ width: 150 }}>
          <option value="all">Все авторы</option><option value="agent">Агент</option><option value="user">Вы</option>
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 190 }}>
          <option value="all">Все типы</option>
          {types.map((t) => <option key={t} value={t}>{ACTION_TYPE_LABEL[t] || t}</option>)}
        </Select>
        <div className="grow" style={{ minWidth: 180, maxWidth: 340 }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по журналу…" />
        </div>
      </div>

      {isLoading && <div className="col gap12">{[1, 2, 3, 4].map((i) => <Skeleton key={i} h={64} />)}</div>}

      {!isLoading && list.length === 0 && (
        <div className="tile">
          <EmptyState icon="journal" title={actions.length ? 'Ничего не найдено' : 'Журнал пуст'}
            text={actions.length ? 'Попробуйте другой фильтр или запрос.' : 'Здесь фиксируется каждое изменение агента и ваши действия — с источником, временем и кнопкой отката.'}
            action={!actions.length ? <Button variant="primary" icon="plus" onClick={() => setForm({})}>Добавить запись</Button> : null} />
        </div>
      )}

      {groups.map((g) => (
        <div key={g.label}>
          <div className="day-label">{g.label}</div>
          <div className="tile" style={{ padding: '2px 10px' }}>
            {g.items.map((a) => (
              <div className="act-item" key={a.id}>
                <span className={`act-icon ${a.actor === 'user' ? 'user' : ''} ${a.type === 'rollback' ? 'rollback' : ''}`}>
                  <Icon name={TYPE_ICON[a.type] || 'dot'} size={14} />
                </span>
                <div className="grow">
                  <div className="act-title">{a.title}</div>
                  {a.note && <div className="act-note">{a.note}</div>}
                  <div className="act-meta">
                    <span className="num">{fmtWhen(a.created_at)}</span>·
                    <Chip kind={a.actor === 'agent' ? 'muted' : 'outline'}>{a.actor === 'agent' ? 'агент' : 'вы'}</Chip>
                    <span>{ACTION_TYPE_LABEL[a.type] || a.type}</span>
                    {a.undone_at && <Chip kind="warn">откатано</Chip>}
                    {a.provenance && <How data={a.provenance} />}
                    <button className="how-btn" onClick={() => nav(actionLink(a.target))}>открыть<Icon name="chevRight" size={10} /></button>
                  </div>
                </div>
                <div className="flex gap4 aifs">
                  {!a.undone_at && a.payload && <Button size="xs" icon="undo" onClick={() => requestUndo(a)}>Откатить</Button>}
                  <button className="icon-btn" title="Изменить" onClick={() => setForm({ item: a })}><Icon name="edit" size={13} /></button>
                  <button className="icon-btn danger" title="Удалить" onClick={() => setDel(a)}><Icon name="trash" size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {form && <ActionForm initial={form.item} cabinetId={cabinet.id} onClose={() => setForm(null)} />}
      <Confirm open={!!del} onClose={() => setDel(null)} title="Удалить запись?" text={del ? `«${del.title}» исчезнет из журнала. Само изменение при этом не откатывается.` : ''} confirmLabel="Удалить" danger loading={delMut.isPending} onConfirm={() => delMut.mutate(del.id)} />
    </div>
  )
}
