import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, fmtMoney, fmtInt, fmtVal, fmtDate, CARD_STATUS } from '../api.js'
import { Icon, Chip, Button, Skeleton, Confirm, How, AgentBadge, Stepper, HypStatusChip, VerdictChip, PriorityDot, Funnel, ProgressBar, StatusChip, useToast, EmptyState } from '../ui.jsx'
import { BenchmarkScale, EffectCI, BeforeAfter, WaveTrack, LinesChart } from '../charts.jsx'
import { useShell, ActionFeed } from '../layout.jsx'
import { AcceptModal, TestEditModal, ScaleModal, HypothesisForm } from '../forms.jsx'
import { useRefreshAll } from '../hooks.js'

const STEPS = ['Факт', 'Гипотеза', 'Тест', 'Интерпретация', 'Решение']
const CURRENT = { new: 1, accepted: 2, testing: 2, interpreted: 3, scaled: 5, rolled_back: 5 }

export default function HypothesisDetail() {
  const { id } = useParams()
  const { cabinet, requestUndo } = useShell()
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefreshAll(cabinet.id)
  const { data, isLoading } = useQuery({ queryKey: ['hypothesis', id], queryFn: () => api(`/hypotheses/${id}`) })
  const [modal, setModal] = useState(null) // accept | testEdit | scale | edit
  const [confirm, setConfirm] = useState(null) // {kind}

  const done = (msg) => { toast(msg); refresh([['hypothesis', id], ['category', data?.hypothesis?.category_id]]); setConfirm(null) }
  const fail = (e) => { toast(e.message, 'error'); setConfirm(null) }
  const startMut = useMutation({ mutationFn: () => api(`/tests/${data.test.id}/start`, { method: 'POST' }), onSuccess: () => done('Тест запущен') , onError: fail })
  const completeMut = useMutation({ mutationFn: () => api(`/tests/${data.test.id}/complete`, { method: 'POST' }), onSuccess: () => done('Тест завершён, интерпретация готова'), onError: fail })
  const delTestMut = useMutation({ mutationFn: () => api(`/tests/${data.test.id}`, { method: 'DELETE' }), onSuccess: () => done('Тест удалён, гипотеза возвращена в новые'), onError: fail })
  const rollbackMut = useMutation({ mutationFn: () => api(`/interpretations/${data.interpretation.id}/decide`, { method: 'POST', body: { decision: 'rollback' } }), onSuccess: () => done('Изменения откачены, запись в журнале'), onError: fail })
  const advanceMut = useMutation({ mutationFn: () => api(`/rollouts/${data.rollout.id}/advance`, { method: 'POST' }), onSuccess: () => done('Следующая волна раскатана'), onError: fail })
  const delHypMut = useMutation({ mutationFn: () => api(`/hypotheses/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Гипотеза удалена'); refresh(); nav('/hypotheses') }, onError: fail })

  const waveActions = useMemo(() => (data?.actions || []).filter((a) => a.type === 'wave' && a.target?.id === data?.rollout?.id), [data])
  const startAction = useMemo(() => (data?.actions || []).find((a) => a.type === 'test_start' && a.target?.id === data?.test?.id), [data])

  if (isLoading) return <div className="page"><Skeleton w={420} h={28} /><Skeleton h={40} style={{ marginTop: 14 }} /><Skeleton h={180} style={{ marginTop: 14 }} /><Skeleton h={220} style={{ marginTop: 14 }} /></div>
  if (!data) return null
  const { hypothesis: h, category, fact, test, interpretation: interp, rollout, cards, actions } = data
  const progress = test?.required_n ? Math.min(100, Math.round((test.current_n / test.required_n) * 100)) : 0
  const myCards = cards.filter((c) => (h.card_ids || []).includes(c.id))
  const controlCards = rollout ? cards.filter((c) => rollout.control_ids.includes(c.id)) : []
  const pendingWave = rollout?.waves?.find((w) => w.status === 'pending')
  const failAt = interp?.verdict === 'failed' && h.status === 'interpreted' ? 3 : null

  return (
    <div className="page">
      <div className="crumb mb12"><a className="clickable" onClick={() => nav('/hypotheses')}>Гипотезы</a><Icon name="chevRight" size={11} /><span className="ellipsis" style={{ maxWidth: 340 }}>{h.title}</span></div>
      <div className="page-head">
        <div>
          <div className="flex aic gap8 wrap">
            <h1>{h.title}</h1>
            <HypStatusChip status={h.status} />
            {h.origin === 'agent' && <span className="badge-agent"><Icon name="spark" size={11} />создана агентом</span>}
          </div>
          <div className="flex aic gap12 mt8 wrap">
            <a className="crumb clickable" onClick={() => nav(`/categories/${h.category_id}`)}><Icon name="layers" size={12} />{category?.name}</a>
            <PriorityDot p={h.priority} />
            <span className="small bold num" style={{ color: 'var(--primary)' }}>ожидание +{fmtMoney(h.expected_rub, { compact: true })}/мес</span>
            <How data={{ source: 'Оценка Леммы', sample: `${category?.name}: эластичность категории`, period: 'прогноз на 30 дней', method: 'Разрыв с бенчмарком × медианный отклик лидеров на признак' }} />
          </div>
        </div>
        <div className="flex gap8">
          <Button size="sm" icon="edit" onClick={() => setModal('edit')}>Изменить</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirm({ kind: 'delHyp' })}>Удалить</Button>
        </div>
      </div>

      <Stepper steps={STEPS} current={CURRENT[h.status] ?? 1} failAt={failAt} />

      {/* 1. Факт */}
      <div className="tile mb16">
        <div className="tile-head"><span className="tile-title">1 · Факт категории — откуда выросла гипотеза</span>
          <a className="tile-link" onClick={() => nav(`/categories/${h.category_id}?tab=${h.fact_kind === 'benchmark' ? 'benchmarks' : 'patterns'}`)}>досье категории<Icon name="chevRight" size={11} /></a>
        </div>
        <div className="tile-pad">
          <div className="info-box mb12"><Icon name="target" size={15} /><span>{h.fact_text}</span></div>
          {fact?.kind === 'benchmark' && (
            <div>
              <div className="flex aic gap8 mb8"><span className="small semi">{fact.metric}</span>{fact.status ? <StatusChip status={fact.status} /> : null}
                <How data={{ source: fact.source, sample: `${fmtInt(fact.sample)} карточек`, period: fact.period, method: fact.method }} />
              </div>
              <BenchmarkScale b={fact} />
            </div>
          )}
          {fact?.kind === 'pattern' && (
            <div className="flex aic gap12 wrap">
              <span className={`impact ${fact.impact}`}>{fact.impact}</span>
              <span className="small semi">{fact.title}</span>
              <span className="tiny muted">у <b className="num" style={{ color: 'var(--primary)' }}>{fact.prevalence}%</b> лидеров</span>
              <div className="prev-track"><div className="prev-fill" style={{ width: `${fact.prevalence}%` }} /></div>
              <How data={{ source: fact.source, sample: `${fact.sample} лидеров`, period: fact.period, method: fact.method }} />
            </div>
          )}
        </div>
      </div>

      {/* 2. Гипотеза */}
      <div className="tile mb16">
        <div className="tile-head"><span className="tile-title">2 · Гипотеза</span><Funnel stage={h.funnel_stage} /></div>
        <div className="tile-pad">
          <div className="flex jcb aic wrap gap12">
            <div className="grow">
              <div className="small">Провалена стадия <b>«{h.funnel_stage}»</b>. Меняем: {h.title.toLowerCase()}.</div>
              {myCards.length > 0 && (
                <div className="flex gap6 wrap mt8">
                  {myCards.map((c) => <Chip key={c.id} kind="muted">{c.name}</Chip>)}
                </div>
              )}
            </div>
            {h.status === 'new' && <Button variant="primary" icon="check" onClick={() => setModal('accept')}>Принять и рассчитать тест</Button>}
          </div>
        </div>
      </div>

      {/* 3. Тест */}
      {test && (
        <div className="tile mb16">
          <div className="tile-head">
            <span className="tile-title">3 · Тест</span>
            <div className="flex aic gap8">
              <Chip kind={test.status === 'running' ? 'ok' : test.status === 'completed' ? 'muted' : test.status === 'aborted' ? 'warn' : 'outline'}>
                {{ draft: 'Рассчитан', running: 'Идёт', completed: 'Завершён', aborted: 'Остановлен' }[test.status]}
              </Chip>
              {startAction && <AgentBadge action={startAction} onUndo={requestUndo} />}
            </div>
          </div>
          <div className="tile-pad">
            <div className="stat-grid mb12">
              <div className="stat-cell"><div className="k">Основная метрика</div><div className="v" style={{ fontSize: 13 }}>{test.metric}</div></div>
              <div className="stat-cell"><div className="k">База</div><div className="v num">{String(test.baseline).replace('.', ',')}%</div></div>
              <div className="stat-cell"><div className="k">Мин. эффект</div><div className="v num">+{String(test.mde).replace('.', ',')} п.п.</div></div>
              <div className="stat-cell"><div className="k">Мощность</div><div className="v num">{Math.round(test.power * 100)}%</div></div>
              <div className="stat-cell"><div className="k">Значимость</div><div className="v num">α = {String(test.alpha).replace('.', ',')}</div></div>
              <div className="stat-cell"><div className="k">Наблюдений нужно</div><div className="v num">{fmtInt(test.required_n)}</div></div>
            </div>
            {test.status === 'running' && (
              <div className="mb12">
                <div className="flex jcb aic mb8 small">
                  <span className="semi">Набор мощности</span>
                  <span className="muted num">{fmtInt(test.current_n)} / {fmtInt(test.required_n)} · до {fmtDate(test.end_date)}</span>
                </div>
                <ProgressBar value={progress} label={`${progress}% выборки набрано`} />
              </div>
            )}
            {test.warnings?.length > 0 && (
              <div className="col gap8 mb12">
                {test.warnings.map((w, i) => <div key={i} className="warn-box"><Icon name="alert" size={15} /><span>{w}</span></div>)}
              </div>
            )}
            <div className="flex gap8 wrap">
              {test.status === 'draft' && <>
                <Button variant="primary" icon="play" onClick={() => startMut.mutate()} disabled={startMut.isPending}>Запустить тест</Button>
                <Button icon="edit" onClick={() => setModal('testEdit')}>Параметры</Button>
                <Button variant="danger" icon="trash" onClick={() => setConfirm({ kind: 'delTest' })}>Удалить тест</Button>
              </>}
              {test.status === 'running' && <Button icon="check" onClick={() => setConfirm({ kind: 'complete' })}>Завершить и интерпретировать</Button>}
              {test.status === 'aborted' && <Button variant="primary" icon="play" onClick={() => startMut.mutate()} disabled={startMut.isPending}>Перезапустить</Button>}
            </div>
          </div>
        </div>
      )}

      {/* 4. Интерпретация */}
      {interp && (
        <div className="tile mb16">
          <div className="tile-head">
            <span className="tile-title">4 · Интерпретация</span>
            <div className="flex aic gap8">
              <VerdictChip verdict={interp.verdict} />
              <How align="right" data={{ source: 'A/B тест', sample: `${fmtInt(test?.current_n)} наблюдений`, period: `${test?.start_date || '—'} — ${test?.end_date || '—'}`, method: 'Двухдолевой z-тест, 95% доверительный интервал' }} />
            </div>
          </div>
          <div className="tile-pad">
            <div className="small mb12" style={{ maxWidth: 720 }}>{interp.summary}</div>
            <div className="mb12">
              {interp.effects.map((e, i) => <EffectCI key={i} effect={e} />)}
              <div className="tiny faint mt4">Точка — оценка эффекта, полоса — 95% доверительный интервал. Эффект подтверждён, если интервал не пересекает ноль.</div>
            </div>
            <div className="grid g23">
              <div>
                <div className="tiny bold muted mb8" style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>Контрольные метрики</div>
                <div className="tbl-wrap"><BeforeAfter rows={interp.controls} /></div>
              </div>
              <div className="tile tile-pad" style={{ background: interp.effect_rub >= 0 ? 'var(--primary-08)' : 'var(--danger-bg)', borderColor: 'transparent' }}>
                <div className="tiny muted">Эффект на выручку</div>
                <div className="big-rub num mt4" style={{ color: interp.effect_rub >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                  {interp.effect_rub >= 0 ? '+' : '−'}{fmtMoney(Math.abs(interp.effect_rub), { compact: true })}<span className="small muted" style={{ fontWeight: 500 }}>/мес</span>
                </div>
                <div className="tiny muted mt4">{interp.verdict === 'confirmed' ? 'подтверждено тестом' : interp.verdict === 'failed' ? 'потери за время теста' : 'эффект не доказан'}</div>
              </div>
            </div>

            {/* 5. Решение: ровно два действия */}
            <div className="divider" />
            {!interp.decided ? (
              <div className="flex jcb aic wrap gap12">
                <div>
                  <div className="small bold" style={{ color: 'var(--primary)' }}>5 · Решение — ровно два пути</div>
                  <div className="tiny muted mt4">Вернуть как было или раскатать волнами на похожие артикулы с контрольной группой.</div>
                </div>
                <div className="flex gap8 wrap">
                  <Button variant="danger" icon="undo" onClick={() => setConfirm({ kind: 'rollback' })}>Откатить изменение</Button>
                  <Button variant="primary" icon="wave" onClick={() => setModal('scale')}>Масштабировать волнами</Button>
                </div>
              </div>
            ) : (
              <div className="flex aic gap8">
                <span className="small bold" style={{ color: 'var(--primary)' }}>5 · Решение принято:</span>
                <Chip kind={interp.decided === 'scale' ? 'ok' : 'muted'}>{interp.decided === 'scale' ? 'масштабирование волнами' : 'откат'}</Chip>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Раскатка */}
      {rollout && (
        <div className="tile mb16">
          <div className="tile-head">
            <span className="tile-title">Раскатка волнами</span>
            <div className="flex aic gap8">
              <Chip kind={rollout.status === 'done' ? 'ok' : rollout.status === 'paused' ? 'warn' : 'outline'}>
                {{ done: 'Раскатано', active: 'Идёт', paused: 'Пауза после отката' }[rollout.status]}
              </Chip>
              {pendingWave && <Button size="sm" variant="primary" icon="wave" onClick={() => advanceMut.mutate()} disabled={advanceMut.isPending}>Раскатить волну {pendingWave.n}</Button>}
            </div>
          </div>
          <div className="tile-pad">
            <WaveTrack waves={rollout.waves} controlCount={rollout.control_ids.length} />
            {rollout.series?.labels?.length > 0 && (
              <div className="mt16">
                <div className="flex jcb aic mb8 wrap gap8">
                  <span className="small semi">Заказы: управляемые против контроля, индекс к старту</span>
                  <div className="legend">
                    <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--primary)' }} />управляемые</span>
                    <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--faint)' }} />контроль</span>
                  </div>
                </div>
                <LinesChart labels={rollout.series.labels} series={[
                  { name: 'Управляемые', data: rollout.series.managed, color: '#2F4F4F' },
                  { name: 'Контроль', data: rollout.series.control, color: '#A5A5A2', dash: '5 4' }
                ]} />
              </div>
            )}
            {controlCards.length > 0 && (
              <div className="tiny muted mt12">Контрольная группа сохраняется без изменений: {controlCards.map((c) => c.name).join(', ')}.</div>
            )}
            {waveActions.length > 0 && (
              <div className="flex gap6 wrap mt12">
                {waveActions.slice(0, 4).map((a) => <AgentBadge key={a.id} action={a} onUndo={requestUndo} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Журнал объекта */}
      <div className="tile">
        <div className="tile-head"><span className="tile-title">Журнал объекта</span><span className="tiny muted">все изменения по цепочке</span></div>
        <div style={{ padding: '2px 10px 6px' }}>
          {actions.length === 0 && <div className="small muted" style={{ padding: 14 }}>Действий по этой цепочке пока не было.</div>}
          <ActionFeed actions={actions.slice(0, 10)} compact onUndo={requestUndo} onNavigate={nav} />
        </div>
      </div>

      {/* модальные окна */}
      {modal === 'accept' && <AcceptModal hypothesis={h} onClose={() => setModal(null)} />}
      {modal === 'testEdit' && <TestEditModal test={test} hypothesis={h} onClose={() => setModal(null)} />}
      {modal === 'scale' && <ScaleModal hypothesis={{ ...h, category_name: category?.name }} interpretation={interp} cards={cards} onClose={() => setModal(null)} />}
      {modal === 'edit' && <HypothesisForm initial={h} cabinetId={cabinet.id} categories={[category]} onClose={() => setModal(null)} />}

      <Confirm open={confirm?.kind === 'complete'} onClose={() => setConfirm(null)} title="Завершить тест?"
        text={progress < 100 ? `Мощность ${progress}%: доверительный интервал будет шире расчётного, результат может оказаться неоднозначным. Завершить сейчас?` : 'Выборка набрана. Тест будет остановлен, эффект интерпретирован с доверительным интервалом.'}
        confirmLabel="Завершить" loading={completeMut.isPending} onConfirm={() => completeMut.mutate()} />
      <Confirm open={confirm?.kind === 'rollback'} onClose={() => setConfirm(null)} title="Откатить изменение?"
        text="Все изменения карточек в рамках этой гипотезы вернутся к состоянию «до». Откат запишется в журнал, гипотеза будет закрыта."
        confirmLabel="Откатить" danger loading={rollbackMut.isPending} onConfirm={() => rollbackMut.mutate()} />
      <Confirm open={confirm?.kind === 'delTest'} onClose={() => setConfirm(null)} title="Удалить тест?"
        text="Расчёт теста будет удалён, гипотеза вернётся в стадию «Новая»." confirmLabel="Удалить" danger loading={delTestMut.isPending} onConfirm={() => delTestMut.mutate()} />
      <Confirm open={confirm?.kind === 'delHyp'} onClose={() => setConfirm(null)} title="Удалить гипотезу?"
        text="Гипотеза и связанные тест, интерпретация и раскатка будут удалены. Записи в журнале останутся." confirmLabel="Удалить" danger loading={delHypMut.isPending} onConfirm={() => delHypMut.mutate()} />
    </div>
  )
}
