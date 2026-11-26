import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, fmtMoney, fmtInt, fmtVal, fmtDate, GROUPS } from '../api.js'
import { Icon, Chip, StatusChip, HypStatusChip, Skeleton, EmptyState, How, Button, ProgressBar } from '../ui.jsx'
import { Sparkline, Radar } from '../charts.jsx'
import { useShell, ActionFeed } from '../layout.jsx'
import { AgentRunButton } from '../agent.jsx'

export default function Dashboard() {
  const { cabinet, openAgent, requestUndo } = useShell()
  const nav = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['overview', cabinet.id], queryFn: () => api(`/cabinets/${cabinet.id}/overview`) })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return null

  const confirmed = data.results.filter((r) => r.verdict === 'confirmed')
  const failed = data.results.filter((r) => r.verdict === 'failed')

  if (!data.categories.length) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>{cabinet.name}</h1><div className="page-sub">Кабинет подключён, данных пока нет.</div></div></div>
        <div className="tile">
          <EmptyState icon="layers" title="Начните с категории"
            text="Категория — самостоятельная сущность со своей нормой контента, логистикой и рекламой. Добавьте первую категорию, затем бенчмарки и паттерны — агент найдёт разрывы и предложит гипотезы."
            action={<Button variant="primary" icon="plus" onClick={() => nav('/categories')}>Добавить категорию</Button>} />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{cabinet.name}</h1>
          <div className="page-sub">{cabinet.seller} · {cabinet.marketplace} · период {data.period}</div>
        </div>
        <How data={data.provenance} align="right" label="как считаются показатели" />
      </div>

      {/* KPI */}
      <div className="grid g4">
        {data.kpis.map((k) => (
          <div key={k.key} className="tile tile-pad hover" onClick={() => nav('/categories')}>
            <div className="flex jcb aic">
              <span className="kpi-label">{k.title}</span>
              <span className={`kpi-delta num ${k.delta === 0 ? 'flat' : k.good ? 'up' : 'down'}`}>
                <Icon name={k.delta >= 0 ? 'arrowUR' : 'arrowDR'} size={10} />{Math.abs(k.delta).toString().replace('.', ',')}%
              </span>
            </div>
            <div className="kpi-value num">{k.fmt === 'money' ? fmtMoney(k.value, { compact: true }) : k.fmt === 'pct' ? `${String(k.value).replace('.', ',')}%` : fmtInt(k.value)}</div>
            <div className="mt8"><Sparkline data={k.spark} /></div>
          </div>
        ))}
      </div>

      {/* Карта категорий */}
      <div className="section-title">Карта категорий <span className="tiny faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>где вы внутри нормы, а где выпали</span></div>
      <div className="grid g3">
        {data.categories.map((c) => (
          <div key={c.id} className="tile tile-pad hover" onClick={() => nav(`/categories/${c.id}`)}>
            <div className="flex aic gap10 mb8">
              <span className="cat-icon"><Icon name={c.icon || 'box'} size={19} /></span>
              <div className="grow">
                <div className="bold" style={{ color: 'var(--primary)' }}>{c.name}</div>
                <div className="tiny muted">{c.marketplace} · {c.cards_count} арт.</div>
              </div>
              <StatusChip status={c.overall} />
            </div>
            <div className="flex gap12 aic">
              <Radar profile={c.profile} size={104} labels={false} />
              <div className="grow">
                <div className="small semi" style={{ color: 'var(--primary)' }}>{c.thesis}</div>
                <div className="col gap4 mt8">
                  {c.gaps.length === 0 && <span className="tiny muted">Все ключевые метрики в норме категории</span>}
                  {c.gaps.map((g) => (
                    <div key={g.id} className="flex jcb aic gap6">
                      <span className="tiny muted ellipsis">{g.metric}</span>
                      <span className="tiny num nowrap"><b style={{ color: 'var(--danger)' }}>{fmtVal(g.seller, g.unit)}</b><span className="faint"> / {fmtVal(g.p25, g.unit)}–{fmtVal(g.p75, g.unit)}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex jcb aic mt12" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 9 }}>
              <span className="tiny muted">выручка за 30 дней</span>
              <span className="small bold num" style={{ color: 'var(--primary)' }}>{fmtMoney(c.revenue30, { compact: true })}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Гипотезы + результаты */}
      <div className="grid g23 mt24">
        <div className="tile">
          <div className="tile-head">
            <span className="tile-title">Активные гипотезы и тесты</span>
            <div className="flex aic gap8">
              <AgentRunButton size="xs" label="Подобрать гипотезы" />
              <a className="tile-link" onClick={(e) => { e.stopPropagation(); nav('/hypotheses') }}>все<Icon name="chevRight" size={11} /></a>
            </div>
          </div>
          {data.active.length === 0 && <EmptyState icon="flask" title="Нет активных гипотез" text="Создайте гипотезу из разрыва с бенчмарком — или дождитесь предложения агента." action={<Button size="sm" variant="soft" icon="plus" onClick={() => nav('/hypotheses')}>Новая гипотеза</Button>} />}
          {data.active.map((h) => (
            <div key={h.id} className="hyp-row" onClick={() => nav(`/hypotheses/${h.id}`)}>
              <div className="grow">
                <div className="flex aic gap8 wrap">
                  <span className="hyp-title">{h.title}</span>
                  {h.origin === 'agent' && <span className="badge-agent"><Icon name="spark" size={10} />агент</span>}
                </div>
                <div className="tiny muted mt4">{h.category_name} · стадия «{h.funnel_stage}»</div>
                {h.test?.status === 'running' && (
                  <div className="mt8" style={{ maxWidth: 320 }}>
                    <ProgressBar value={h.test.progress} label={`мощность ${h.test.progress}% · до ${fmtDate(h.test.end_date)}`} />
                  </div>
                )}
              </div>
              <div className="hyp-side">
                <HypStatusChip status={h.status} />
                <span className="small bold num" style={{ color: 'var(--primary)' }}>+{fmtMoney(h.expected_rub, { compact: true })}/мес</span>
              </div>
            </div>
          ))}
        </div>

        <div className="col gap16">
          <div className="tile tile-pad accent hover" onClick={() => confirmed[0] && nav(`/hypotheses/${confirmed[0].hypothesis_id}`)}>
            <div className="flex jcb aic mb8"><Chip kind="ok"><Icon name="check" size={11} />Подтверждено</Chip><Icon name="chevRight" size={14} style={{ color: 'var(--muted)' }} /></div>
            {confirmed.length ? (
              <>
                <div className="big-rub num" style={{ color: 'var(--primary)' }}>+{fmtMoney(confirmed[0].effect_rub, { compact: true })}<span className="small muted" style={{ fontWeight: 500 }}>/мес</span></div>
                <div className="small semi mt4">{confirmed[0].title}</div>
                <div className="tiny muted mt4">{confirmed[0].category_name} · {confirmed[0].decided === 'scale' ? 'раскатано волнами, контроль сохранён' : 'готово к масштабированию'}</div>
              </>
            ) : <div className="small muted">Подтверждённых результатов за период пока нет.</div>}
          </div>
          <div className="tile tile-pad fail hover" onClick={() => failed[0] && nav(`/hypotheses/${failed[0].hypothesis_id}`)}>
            <div className="flex jcb aic mb8"><Chip kind="gap"><Icon name="x" size={11} />Провал</Chip><Icon name="chevRight" size={14} style={{ color: 'var(--muted)' }} /></div>
            {failed.length ? (
              <>
                <div className="big-rub num" style={{ color: 'var(--danger)' }}>−{fmtMoney(Math.abs(failed[0].effect_rub), { compact: true })}</div>
                <div className="small semi mt4">{failed[0].title}</div>
                <div className="tiny muted mt4">{failed[0].category_name} · {failedCaption(failed[0])}{failed[0].decided ? '' : ' — решение ждёт вас'}</div>
              </>
            ) : <div className="small muted">Провалов за период нет — и это тоже результат.</div>}
          </div>
        </div>
      </div>

      {/* Паттерны и изменения */}
      <div className="section-title">Свежие паттерны и изменения категорий</div>
      <div className="tile">
        {data.feed.length === 0 && <EmptyState icon="calendar" title="Событий пока нет" text="Здесь появятся изменения площадок и новые паттерны лидеров по вашим категориям." />}
        {data.feed.map((f) => (
          <div key={f.kind + f.id} className="feed-row" onClick={() => nav(`/categories/${f.category_id}?tab=${f.kind === 'event' ? 'events' : 'patterns'}`)}>
            <span className="act-icon"><Icon name={f.kind === 'event' ? 'calendar' : 'spark'} size={14} /></span>
            <div className="grow">
              <div className="small semi">{f.title}</div>
              <div className="tiny muted mt4 flex aic gap6 wrap">
                <span>{fmtDate(f.date)}</span>·<span>{f.category_name}</span>
                {f.kind === 'event' && (f.affected ? <Chip kind="warn">повлияло</Chip> : <Chip kind="muted">без влияния</Chip>)}
                {f.kind === 'pattern' && <Chip kind="ok">{GROUPS[f.grp]} · у {f.prevalence}% лидеров</Chip>}
              </div>
              {f.note && <div className="tiny muted mt4">{f.note}</div>}
            </div>
            <Icon name="chevRight" size={13} style={{ color: 'var(--faint)', marginTop: 4 }} />
          </div>
        ))}
      </div>

      {/* Лента действий */}
      <div className="tile mt24">
        <div className="tile-head">
          <span className="tile-title">Последние действия</span>
          <Button size="xs" variant="ghost" icon="activity" onClick={openAgent}>Все действия</Button>
        </div>
        <div style={{ padding: '2px 10px 6px' }}>
          {data.recent.length === 0 && <div className="small muted" style={{ padding: 14 }}>Действий пока не было.</div>}
          <ActionFeed actions={data.recent.slice(0, 5)} compact onUndo={requestUndo} onNavigate={nav} />
        </div>
      </div>
    </div>
  )
}

function failedCaption(r) {
  const fx = r.effects || []
  const ctr = fx.find((e) => e.metric === 'CTR')
  const prim = fx.find((e) => e.primary)
  const parts = []
  if (ctr) parts.push(`CTR ${ctr.delta > 0 ? '+' : '−'}${Math.abs(ctr.delta)}%`)
  if (prim && prim.metric !== 'CTR') parts.push(`${prim.metric.toLowerCase()} ${prim.delta > 0 ? '+' : '−'}${Math.abs(prim.delta)}${prim.unit === '%' ? '%' : ' п.п.'}`)
  return parts.join(', ') || 'эффект ниже нуля'
}

function DashboardSkeleton() {
  return (
    <div className="page">
      <Skeleton w={260} h={26} /><Skeleton w={380} h={14} style={{ marginTop: 8 }} />
      <div className="grid g4 mt20">{[1, 2, 3, 4].map((i) => <Skeleton key={i} h={118} />)}</div>
      <div className="grid g3 mt20">{[1, 2, 3].map((i) => <Skeleton key={i} h={190} />)}</div>
      <div className="grid g23 mt20"><Skeleton h={240} /><Skeleton h={240} /></div>
    </div>
  )
}
