// Запуск агентного цикла: контекст → LLM (AITunnel) → черновики гипотез / совет.
// Никакого собственного таба у агента нет — только контекстные кнопки и это окно.
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, fmtMoney, fmtRub } from './api.js'
import { Modal, Button, Icon, Skeleton, useToast } from './ui.jsx'
import { useShell } from './layout.jsx'

export function AgentRunButton({ mode = 'scan', categoryId, label = 'Подобрать гипотезы', size = 'sm', variant = 'soft' }) {
  const { openAgentRun } = useShell()
  return <Button size={size} variant={variant} icon="spark" onClick={() => openAgentRun({ mode, categoryId })}>{label}</Button>
}

export function AgentRunModal({ options, onClose }) {
  const { cabinet, refresh } = useShell()
  const nav = useNavigate()
  const toast = useToast()
  const { data: cfg, isLoading } = useQuery({ queryKey: ['agent-config'], queryFn: () => api('/agent/config'), staleTime: 30000 })
  const mode = options?.mode || 'scan'
  const mut = useMutation({
    mutationFn: () => api('/agent/run', { method: 'POST', body: { cabinet_id: cabinet.id, mode, category_id: options?.categoryId || undefined } }),
    onSuccess: (d) => {
      refresh()
      if (mode === 'scan') toast(d.created?.length ? `Агент создал гипотез: ${d.created.length}` : 'Агент: новых разрывов нет')
    },
    onError: (e) => toast(e.message, 'error')
  })
  const d = mut.data
  const title = mode === 'scan' ? 'Агент: поиск гипотез' : 'Агент: разбор результата'
  const left = cfg ? Math.max(0, cfg.month_budget_rub - cfg.month_spent_rub) : 0

  return (
    <Modal open onClose={onClose} title={title} wide
      foot={<>
        <Button onClick={onClose}>{d ? 'Закрыть' : 'Отмена'}</Button>
        {cfg?.configured && !d && (
          <Button variant="primary" icon="spark" disabled={mut.isPending || left <= 0} onClick={() => mut.mutate()}>
            {mut.isPending ? 'Агент думает…' : mode === 'scan' ? 'Запустить разбор' : 'Получить разбор'}
          </Button>
        )}
      </>}>
      {isLoading && <div className="col gap8"><Skeleton h={16} /><Skeleton h={16} w="70%" /><Skeleton h={40} /></div>}

      {cfg && !cfg.configured && (
        <div className="col gap12">
          <div className="warn-box"><Icon name="alert" size={15} /><span>Агент не подключён: серверу нужен ключ AITunnel. Это делается один раз.</span></div>
          <ol className="small col gap8" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.55 }}>
            <li>Возьмите API-ключ в кабинете <b>aitunnel.ru</b> (раздел «API ключи»).</li>
            <li>В Render откройте сервис <b>lemma</b> → <b>Environment</b> → добавьте переменную <b>AITUNNEL_API_KEY</b> со значением ключа.</li>
            <li>Сохраните — сервис перезапустится сам. Вернитесь сюда и нажмите «Запустить разбор».</li>
          </ol>
          <div className="tiny muted">Ключ хранится только на сервере и никогда не попадает в браузер. По умолчанию используется недорогая модель deepseek-v4.1-flash; сменить можно переменной AITUNNEL_MODEL. Подробная инструкция — в DEPLOY.md репозитория.</div>
        </div>
      )}

      {cfg?.configured && !d && !mut.isPending && (
        <div className="col gap12">
          <div className="small" style={{ lineHeight: 1.6 }}>
            {mode === 'scan'
              ? <>Агент соберёт факты из базы — бенчмарки с вашей позицией, паттерны лидеров, события и карточки{options?.categoryId ? ' выбранной категории' : ' всех категорий'} — и предложит до 3 новых гипотез. Они появятся как черновики со статусом «Новая»: принимать или отклонять — вам.</>
              : <>Агент объяснит результат теста простым языком и порекомендует одно из двух действий. Решение остаётся за вами.</>}
          </div>
          <div className="info-box"><Icon name="info" size={15} /><span>Модель: <b>{cfg.model}</b> · запуск стоит примерно 0,05–0,3 ₽ · израсходовано за месяц: {fmtRub(cfg.month_spent_rub)} из {fmtRub(cfg.month_budget_rub)}</span></div>
          {left <= 0 && <div className="warn-box"><Icon name="alert" size={15} /><span>Месячный лимит агента исчерпан. Увеличьте AGENT_MONTH_BUDGET_RUB в настройках сервера.</span></div>}
          <div className="tiny muted">Агент не меняет карточки, цены и ставки — он только формулирует гипотезы и советы. Каждое действие попадёт в журнал с пометкой «как получено» и возможностью отката.</div>
        </div>
      )}

      {mut.isPending && (
        <div className="col gap10" style={{ padding: '10px 0' }}>
          <div className="flex aic gap8 small semi"><Icon name="spark" size={15} />Агент собирает факты и думает…</div>
          <Skeleton h={14} /><Skeleton h={14} w="85%" /><Skeleton h={14} w="60%" />
          <div className="tiny muted">Обычно 10–40 секунд. Окно можно не закрывать.</div>
        </div>
      )}

      {d && mode === 'scan' && (
        <div className="col gap12">
          <div className="info-box"><Icon name="check" size={15} /><span>{d.summary}</span></div>
          {(d.created || []).map((h) => (
            <button key={h.id} className="tile tile-pad hover" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => { onClose(); nav(`/hypotheses/${h.id}`) }}>
              <div className="flex aic gap8 wrap">
                <span className="badge-agent"><Icon name="spark" size={10} />агент</span>
                <span className="small semi grow">{h.title}</span>
                <span className="small bold num" style={{ color: 'var(--primary)' }}>+{fmtMoney(h.expected_rub, { compact: true })}/мес</span>
                <Icon name="chevRight" size={13} style={{ color: 'var(--faint)' }} />
              </div>
            </button>
          ))}
          {!(d.created || []).length && <div className="small muted">Новых гипотез нет: разрывы уже закрыты существующими гипотезами или метрики в норме.</div>}
          {(d.skipped || []).length > 0 && <div className="tiny muted">Отброшено при проверке: {d.skipped.join('; ')}.</div>}
          <div className="tiny faint num">{d.run.model} · {d.run.tokens_in + d.run.tokens_out} токенов ≈ {fmtRub(d.run.cost_rub)} · {Math.round(d.run.duration_ms / 1000)} с</div>
        </div>
      )}

      {d && mode === 'interpret' && d.advice && (
        <div className="col gap12">
          <div className="small" style={{ lineHeight: 1.6 }}>{d.advice.explanation}</div>
          <div className="info-box"><Icon name="flag" size={15} /><span><b>{d.advice.recommendation === 'scale' ? 'Масштабировать волнами' : 'Откатить изменение'}</b> — {d.advice.reason}</span></div>
          <div className="tiny faint num">{d.run.model} · ≈ {fmtRub(d.run.cost_rub)}</div>
        </div>
      )}
    </Modal>
  )
}
