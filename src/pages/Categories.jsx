import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../api.js'
import { Icon, Chip, Button, Skeleton, EmptyState, Confirm, useToast } from '../ui.jsx'
import { Radar, ProfileBars } from '../charts.jsx'
import { useShell } from '../layout.jsx'
import { CategoryForm } from '../forms.jsx'
import { useRefreshAll } from '../hooks.js'

export default function Categories() {
  const { cabinet } = useShell()
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefreshAll(cabinet.id)
  const { data: cats = [], isLoading } = useQuery({ queryKey: ['categories', cabinet.id], queryFn: () => api(`/categories?cabinet_id=${cabinet.id}`) })
  const [form, setForm] = useState(null) // {item?}
  const [del, setDel] = useState(null)
  const delMut = useMutation({
    mutationFn: (id) => api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Категория удалена'); refresh(); setDel(null) },
    onError: (e) => { toast(e.message, 'error'); setDel(null) }
  })

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Категории</h1>
          <div className="page-sub">Досье каждой категории: бенчмарки, паттерны лидеров, события площадок и ваши карточки против нормы.</div>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setForm({})}>Новая категория</Button>
      </div>

      {isLoading && <div className="grid g3">{[1, 2, 3].map((i) => <Skeleton key={i} h={260} />)}</div>}

      {!isLoading && cats.length === 0 && (
        <div className="tile">
          <EmptyState icon="layers" title="Категорий пока нет"
            text="В одной категории выигрывает контент, в другой логистика, в третьей цена. Добавьте категорию и заполните её досье — бенчмарки и паттерны."
            action={<Button variant="primary" icon="plus" onClick={() => setForm({})}>Добавить категорию</Button>} />
        </div>
      )}

      <div className="grid g3">
        {cats.map((c) => (
          <div key={c.id} className="tile tile-pad hover" onClick={() => nav(`/categories/${c.id}`)}>
            <div className="flex aic gap10">
              <span className="cat-icon"><Icon name={c.icon || 'box'} size={19} /></span>
              <div className="grow">
                <div className="bold" style={{ color: 'var(--primary)' }}>{c.name}</div>
                <div className="tiny muted">{c.marketplace}</div>
              </div>
              <button className="icon-btn" title="Изменить" onClick={(e) => { e.stopPropagation(); setForm({ item: c }) }}><Icon name="edit" size={14} /></button>
              <button className="icon-btn danger" title="Удалить" onClick={(e) => { e.stopPropagation(); setDel(c) }}><Icon name="trash" size={14} /></button>
            </div>
            <div className="small semi mt12" style={{ color: 'var(--primary)' }}>{c.thesis || 'Профиль категории'}</div>
            <div className="tiny muted mt4" style={{ minHeight: 32 }}>{c.description}</div>
            <div className="flex gap12 aic mt8">
              <Radar profile={c.profile} size={116} labels={false} />
              <div className="grow"><ProfileBars profile={c.profile} dense /></div>
            </div>
            <div className="flex jcb aic mt12" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
              <span className="tiny muted num">{c.benchmarks_count} бенчмарков · {c.patterns_count} паттернов · {c.cards_count} арт.</span>
              {c.gaps > 0 ? <Chip kind="warn">{c.gaps} разрыв{c.gaps === 1 ? '' : 'а'}</Chip> : <Chip kind="ok">в норме</Chip>}
            </div>
          </div>
        ))}
      </div>

      {form && <CategoryForm initial={form.item} cabinetId={cabinet.id} onClose={() => setForm(null)} />}
      <Confirm open={!!del} onClose={() => setDel(null)} title={`Удалить «${del?.name}»?`}
        text="Вместе с категорией удалятся её бенчмарки, паттерны, события, карточки и связанные гипотезы с тестами. Действие нельзя отменить."
        confirmLabel="Удалить" danger loading={delMut.isPending} onConfirm={() => delMut.mutate(del.id)} />
    </div>
  )
}
