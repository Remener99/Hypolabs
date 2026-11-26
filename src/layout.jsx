import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api, setToken, safeStore, fmtWhen, dayKey, fmtRub, ACTION_TYPE_LABEL } from './api.js'
import { Icon, Button, Chip, Confirm, How, EmptyState, Skeleton, useToast } from './ui.jsx'
import { actionLink, useRefreshAll } from './hooks.js'
import { AgentRunModal } from './agent.jsx'

const ShellCtx = createContext(null)
export const useShell = () => useContext(ShellCtx)

const TYPE_ICON = {
  card_edit: 'image', price: 'tag', bid: 'target', test_start: 'play', wave: 'wave',
  hypothesis: 'flask', accept: 'check', decide: 'flag', interpretation: 'scale',
  benchmark: 'dashboard', category: 'layers', rollback: 'undo', note: 'journal', test: 'flask',
  agent_scan: 'spark', agent_advice: 'scale'
}

export function Shell() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const loc = useLocation()
  const toast = useToast()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me') })
  const { data: cabinets = [], isLoading: cabLoading } = useQuery({ queryKey: ['cabinets'], queryFn: () => api('/cabinets') })
  const [cabId, setCabId] = useState(() => safeStore.get('lemma_cabinet'))
  const [cabMenu, setCabMenu] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [undoTarget, setUndoTarget] = useState(null)
  const [agentRun, setAgentRun] = useState(null)

  useEffect(() => {
    if (!cabLoading && cabinets.length) {
      if (!cabId || !cabinets.some((c) => c.id === cabId)) {
        setCabId(cabinets[0].id)
        safeStore.set('lemma_cabinet', cabinets[0].id)
      }
    }
  }, [cabLoading, cabinets, cabId])
  useEffect(() => { setSidebarOpen(false) }, [loc.pathname])

  const cabinet = cabinets.find((c) => c.id === cabId) || cabinets[0]
  const switchCab = (id) => { setCabId(id); safeStore.set('lemma_cabinet', id); setCabMenu(false) }

  const { data: recent = [] } = useQuery({
    queryKey: ['agent', cabinet?.id],
    queryFn: () => api(`/agent/recent?cabinet_id=${cabinet.id}`),
    enabled: !!cabinet, refetchInterval: 60000
  })
  const { data: agentCfg } = useQuery({ queryKey: ['agent-config'], queryFn: () => api('/agent/config'), staleTime: 30000 })
  const refresh = useRefreshAll(cabinet?.id)

  const undoMut = useMutation({
    mutationFn: (id) => api(`/actions/${id}/undo`, { method: 'POST' }),
    onMutate: async (id) => {
      const keys = [['agent', cabinet?.id], ['actions', cabinet?.id]]
      const snaps = keys.map((k) => [k, qc.getQueryData(k)])
      for (const k of keys) {
        qc.setQueryData(k, (old) => Array.isArray(old) ? old.map((a) => a.id === id ? { ...a, undone_at: new Date().toISOString() } : a) : old)
      }
      return { snaps }
    },
    onError: (e, id, ctx) => { ctx?.snaps.forEach(([k, v]) => qc.setQueryData(k, v)); toast(e.message, 'error') },
    onSuccess: () => { toast('Изменение откачено, запись в журнале'); refresh() },
    onSettled: () => setUndoTarget(null)
  })

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
    setToken(null)
    qc.clear()
    nav('/login')
  }

  const section = loc.pathname === '/' ? 'Дашборд'
    : loc.pathname.startsWith('/categories') ? 'Категории'
    : loc.pathname.startsWith('/hypotheses') ? 'Гипотезы'
    : loc.pathname.startsWith('/journal') ? 'Журнал действий' : 'Лемма'

  const ctx = { cabinet, cabinets, switchCab, openAgent: () => setAgentOpen(true), requestUndo: setUndoTarget, me, refresh, openAgentRun: (opts) => setAgentRun(opts || { mode: 'scan' }) }

  return (
    <ShellCtx.Provider value={ctx}>
      <div className="shell">
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-logo">
            <span className="logo-mark">
              <svg width="16" height="16" viewBox="0 0 32 32"><rect x="6" y="17" width="4.5" height="9" rx="1" fill="#fff" opacity=".5"/><rect x="13.5" y="11" width="4.5" height="15" rx="1" fill="#fff" opacity=".75"/><rect x="21" y="6" width="4.5" height="20" rx="1" fill="#fff"/></svg>
            </span>
            <div><div className="logo-name">Лемма</div><div className="logo-sub">рост по бенчмаркам</div></div>
          </div>

          <div className="cab-switcher">
            <button className="cab-btn" onClick={() => setCabMenu(!cabMenu)}>
              <span className="cab-avatar">{(cabinet?.name || '…')[0]}</span>
              <span className="grow ellipsis">
                <span className="small semi" style={{ display: 'block' }}>{cabinet?.name || 'Кабинет'}</span>
                <span className="tiny muted">{cabinet?.marketplace}</span>
              </span>
              <Icon name="chevDown" size={13} style={{ color: 'var(--muted)' }} />
            </button>
            {cabMenu && (
              <div className="cab-menu">
                {cabinets.map((c) => (
                  <button key={c.id} className={`cab-menu-item ${c.id === cabinet?.id ? 'active' : ''}`} onClick={() => switchCab(c.id)}>
                    <span className="cab-avatar" style={{ width: 22, height: 22, fontSize: 10 }}>{c.name[0]}</span>
                    <span className="grow ellipsis">{c.name}</span>
                    {c.id === cabinet?.id && <Icon name="check" size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="dashboard" size={17} />Дашборд</NavLink>
            <NavLink to="/categories" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="layers" size={17} />Категории</NavLink>
            <NavLink to="/hypotheses" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="flask" size={17} />Гипотезы</NavLink>
            <NavLink to="/journal" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="journal" size={17} />Журнал</NavLink>
          </nav>

          <div className="sidebar-foot">
            <div className="user-chip">
              <span className="user-avatar">{(me?.user?.name || '…').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
              <span className="grow ellipsis">
                <span className="small semi" style={{ display: 'block' }}>{me?.user?.name}</span>
                <span className="tiny muted">{me?.user?.email}</span>
              </span>
              <button className="icon-btn" title="Выйти" onClick={logout}><Icon name="logout" size={15} /></button>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="burger" onClick={() => setSidebarOpen(true)} aria-label="Меню"><Icon name="menu" size={17} /></button>
            <span className="topbar-section">{section}</span>
            <span className="grow" />
            <button className="agent-btn" onClick={() => setAgentOpen(true)}>
              <Icon name="activity" size={14} />
              Действия
              {recent.length > 0 && <span className="agent-dot num">{recent.length}</span>}
            </button>
          </header>
          {cabinet
            ? <Outlet />
            : <div className="page"><div className="grid g4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} h={110} />)}</div><Skeleton h={220} style={{ marginTop: 14 }} /></div>}
        </div>

        {agentOpen && (
          <>
            <div className="drawer-overlay" onClick={() => setAgentOpen(false)} />
            <aside className="drawer">
              <div className="drawer-head">
                <div>
                  <h2 style={{ fontSize: 15 }}>Свежие действия</h2>
                  <div className="tiny muted">Агент и вы · последние 14 дней</div>
                </div>
                <button className="icon-btn" onClick={() => setAgentOpen(false)} aria-label="Закрыть"><Icon name="x" /></button>
              </div>
              <div className="drawer-body">
                {agentCfg && (
                  <div className="flex jcb aic gap8 wrap" style={{ padding: '0 4px 10px', borderBottom: '1px solid var(--line-soft)', marginBottom: 10 }}>
                    <span className="tiny muted">
                      {agentCfg.configured
                        ? <>Агент: {agentCfg.model} · за месяц ≈ {fmtRub(agentCfg.month_spent_rub)} из {fmtRub(agentCfg.month_budget_rub)}</>
                        : 'Агент не подключён — нужен ключ AITunnel'}
                    </span>
                    <Button size="xs" variant="soft" icon="spark" onClick={() => { setAgentOpen(false); setAgentRun({ mode: 'scan' }) }}>Подобрать гипотезы</Button>
                  </div>
                )}
                {recent.length === 0 && <EmptyState icon="activity" title="Пока тихо" text="Здесь появятся изменения агента и ваши действия: карточки, ставки, цены, тесты и раскатки." />}
                <ActionFeed actions={recent} onUndo={setUndoTarget} onNavigate={(to) => { setAgentOpen(false); nav(to) }} />
              </div>
              <div className="drawer-foot">
                <Button size="sm" block icon="journal" onClick={() => { setAgentOpen(false); nav('/journal') }}>Весь журнал</Button>
              </div>
            </aside>
          </>
        )}

        {agentRun && <AgentRunModal options={agentRun} onClose={() => setAgentRun(null)} />}

        <Confirm
          open={!!undoTarget}
          onClose={() => setUndoTarget(null)}
          title="Откатить изменение?"
          text={undoTarget ? <>«{undoTarget.title}» будет возвращено к состоянию «до». Откат запишется в журнал; связанные карточки, ставки или волны вернутся к прежним значениям.</> : ''}
          confirmLabel="Откатить"
          danger
          loading={undoMut.isPending}
          onConfirm={() => undoMut.mutate(undoTarget.id)}
        />
      </div>
    </ShellCtx.Provider>
  )
}

export function ActionFeed({ actions, onUndo, onNavigate, compact = false }) {
  const groups = useMemo(() => {
    const g = []
    for (const a of actions) {
      const k = dayKey(a.created_at)
      const last = g[g.length - 1]
      if (last && last.label === k) last.items.push(a)
      else g.push({ label: k, items: [a] })
    }
    return g
  }, [actions])
  return (
    <div>
      {groups.map((g) => (
        <div key={g.label}>
          {!compact && <div className="day-label">{g.label}</div>}
          {g.items.map((a) => (
            <div className="act-item" key={a.id}>
              <span className={`act-icon ${a.actor === 'user' ? 'user' : ''} ${a.type === 'rollback' ? 'rollback' : ''}`}>
                <Icon name={TYPE_ICON[a.type] || 'dot'} size={14} />
              </span>
              <div className="grow">
                <div className="act-title">{a.title}</div>
                {a.note && !compact && <div className="act-note">{a.note}</div>}
                <div className="act-meta">
                  <span>{fmtWhen(a.created_at)}</span>
                  <span>·</span>
                  <span>{a.actor === 'agent' ? 'агент' : 'вы'}</span>
                  {a.undone_at && <Chip kind="muted">откатано</Chip>}
                  {a.provenance && <How data={a.provenance} />}
                  {onNavigate && <button className="how-btn" onClick={() => onNavigate(actionLink(a.target))}>открыть<Icon name="chevRight" size={10} /></button>}
                </div>
              </div>
              {!a.undone_at && a.payload && onUndo && (
                <button className="icon-btn" title="Откатить" onClick={() => onUndo(a)}><Icon name="undo" size={14} /></button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
