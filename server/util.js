import { q, uid, now, S, J } from './db.js'
import { rolloutSeries } from './stats.js'

export class HttpError extends Error {
  constructor(code, msg) { super(msg); this.code = code }
}
export const bad = (msg) => { throw new HttpError(400, msg) }
export const notFound = (msg = 'Не найдено') => { throw new HttpError(404, msg) }

export function ownCabinet(userId, id) {
  const c = q.get('SELECT * FROM cabinets WHERE id=? AND user_id=?', id, userId)
  if (!c) notFound('Кабинет не найден')
  return c
}
export function ownCategory(userId, id) {
  const c = q.get('SELECT cat.*, cab.user_id FROM categories cat JOIN cabinets cab ON cab.id=cat.cabinet_id WHERE cat.id=?', id)
  if (!c || c.user_id !== userId) notFound('Категория не найдена')
  return c
}
export function ownHypothesis(userId, id) {
  const h = q.get('SELECT h.*, cab.user_id FROM hypotheses h JOIN cabinets cab ON cab.id=h.cabinet_id WHERE h.id=?', id)
  if (!h || h.user_id !== userId) notFound('Гипотеза не найдена')
  return h
}

export function logAction(cabinetId, actor, type, title, { target = {}, payload = null, note = null, provenance = null } = {}) {
  const id = uid()
  q.run('INSERT INTO actions (id,cabinet_id,actor,type,title,note,target,payload,provenance,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, cabinetId, actor, type, title, note, S(target), payload ? S(payload) : null, provenance ? S(provenance) : null, now())
  return id
}

export function deleteHypothesis(id) {
  const tests = q.all('SELECT id FROM tests WHERE hypothesis_id=?', id)
  for (const t of tests) q.run('DELETE FROM interpretations WHERE test_id=?', t.id)
  q.run('DELETE FROM tests WHERE hypothesis_id=?', id)
  q.run('DELETE FROM rollouts WHERE hypothesis_id=?', id)
  q.run('DELETE FROM hypotheses WHERE id=?', id)
}
export function deleteCategory(id) {
  const hyps = q.all('SELECT id FROM hypotheses WHERE category_id=?', id)
  for (const h of hyps) deleteHypothesis(h.id)
  q.run('DELETE FROM benchmarks WHERE category_id=?', id)
  q.run('DELETE FROM patterns WHERE category_id=?', id)
  q.run('DELETE FROM events WHERE category_id=?', id)
  q.run('DELETE FROM cards WHERE category_id=?', id)
  q.run('DELETE FROM categories WHERE id=?', id)
}

export function setCardField(cardId, field, value) {
  const card = q.get('SELECT * FROM cards WHERE id=?', cardId)
  if (!card) return
  if (field === 'price') q.run('UPDATE cards SET price=? WHERE id=?', value, cardId)
  else if (field === 'status') q.run('UPDATE cards SET status=? WHERE id=?', value, cardId)
  else if (field === 'name' || field === 'sku') q.run(`UPDATE cards SET ${field}=? WHERE id=?`, value, cardId)
  else {
    const m = J(card.metrics, {}); m[field] = value
    q.run('UPDATE cards SET metrics=? WHERE id=?', S(m), cardId)
  }
}

// Откат любого действия агента или пользователя
export function undoAction(userId, actionId) {
  const a = q.get('SELECT a.*, cab.user_id FROM actions a JOIN cabinets cab ON cab.id=a.cabinet_id WHERE a.id=?', actionId)
  if (!a || a.user_id !== userId) notFound('Действие не найдено')
  if (a.undone_at) bad('Действие уже откатано')
  const p = J(a.payload)
  if (!p) bad('Это действие нельзя откатить: оно ничего не изменяло')

  if (p.kind === 'card') {
    setCardField(p.id, p.field, p.before)
  } else if (p.kind === 'benchmark') {
    const b = q.get('SELECT * FROM benchmarks WHERE id=?', p.id)
    if (b) {
      const fields = Object.keys(p.before)
      q.run(`UPDATE benchmarks SET ${fields.map((f) => `${f}=?`).join(',')}, updated_at=? WHERE id=?`, ...fields.map((f) => p.before[f]), now(), p.id)
    }
  } else if (p.kind === 'hypothesis') {
    deleteHypothesis(p.id)
  } else if (p.kind === 'advice') {
    q.run('UPDATE interpretations SET agent_advice=NULL WHERE id=?', p.id)
  } else if (p.kind === 'test_create') {
    const t = q.get('SELECT * FROM tests WHERE id=?', p.id)
    if (t) {
      q.run('DELETE FROM interpretations WHERE test_id=?', t.id)
      q.run('DELETE FROM tests WHERE id=?', t.id)
      q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'new', now(), t.hypothesis_id)
    }
  } else if (p.kind === 'test_start') {
    const t = q.get('SELECT * FROM tests WHERE id=?', p.id)
    if (t) {
      q.run('UPDATE tests SET status=?, current_n=0 WHERE id=?', 'aborted', t.id)
      q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'accepted', now(), t.hypothesis_id)
    }
  } else if (p.kind === 'wave') {
    const r = q.get('SELECT * FROM rollouts WHERE id=?', p.id)
    if (r) {
      const waves = J(r.waves, [])
      const w = waves.find((x) => x.n === p.n)
      if (w) {
        w.status = 'rolled_back'
        for (const cid of w.card_ids) setCardField(cid, 'status', 'active')
        const done = waves.filter((x) => x.status === 'done').length
        const hyp = q.get('SELECT * FROM hypotheses WHERE id=?', r.hypothesis_id)
        const interp = q.get('SELECT i.* FROM interpretations i JOIN tests t ON t.id=i.test_id WHERE t.hypothesis_id=?', r.hypothesis_id)
        const eff = interp ? (J(interp.effects, []).find((e) => e.primary)?.delta ?? 10) : 10
        q.run('UPDATE rollouts SET waves=?, status=?, series=? WHERE id=?', S(waves), done ? 'paused' : 'paused', S(rolloutSeries(done, eff)), r.id)
        if (hyp) q.run('UPDATE hypotheses SET status=?, updated_at=? WHERE id=?', 'scaled', now(), hyp.id)
      }
    }
  } else {
    bad('Неизвестный тип изменения')
  }
  q.run('UPDATE actions SET undone_at=? WHERE id=?', now(), actionId)
  logAction(a.cabinet_id, 'user', 'rollback', `Откат: ${a.title}`, { target: J(a.target, {}), note: 'Изменение возвращено к состоянию «до», запись добавлена в журнал.' })
  return { ok: true }
}

export const parseHyp = (h) => h ? { ...h, card_ids: J(h.card_ids, []) } : h
export const parseTest = (t) => t ? { ...t, warnings: J(t.warnings, []), planned: J(t.planned, {}) } : t
export const parseInterp = (i) => i ? { ...i, effects: J(i.effects, []), controls: J(i.controls, []), agent_advice: J(i.agent_advice) } : i
export const parseRollout = (r) => r ? { ...r, control_ids: J(r.control_ids, []), waves: J(r.waves, []), series: J(r.series, {}) } : r
export const parseCard = (c) => c ? { ...c, metrics: J(c.metrics, {}) } : c
export const parseBench = (b) => b ? { ...b, bins: J(b.bins, []) } : b
export const parseAction = (a) => a ? { ...a, target: J(a.target, {}), payload: J(a.payload), provenance: J(a.provenance) } : a
export const parseCat = (c) => c ? { ...c, profile: J(c.profile, {}) } : c
