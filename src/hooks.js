import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api.js'
import { useToast } from './ui.jsx'

export function useInvalidate() {
  const qc = useQueryClient()
  return (...keys) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }))
}

// Инвалидация всего, что зависит от кабинета
export function useRefreshAll(cabinetId) {
  const qc = useQueryClient()
  return (extra = []) => {
    const keys = [['overview', cabinetId], ['categories', cabinetId], ['hypotheses', cabinetId], ['actions', cabinetId], ['agent', cabinetId], ...extra]
    keys.forEach((k) => qc.invalidateQueries({ queryKey: k }))
  }
}

// Карта последних действий по целям: { 'card:id': action, ... }
export function actionMap(actions = []) {
  const map = {}
  for (const a of actions) {
    if (!a.target?.entity || !a.target?.id) continue
    const key = `${a.target.entity}:${a.target.id}`
    if (!map[key]) map[key] = a
  }
  return map
}

export function actionLink(target = {}) {
  switch (target.entity) {
    case 'category': return `/categories/${target.id}`
    case 'hypothesis': return `/hypotheses/${target.id}`
    case 'test': return target.hypothesis_id ? `/hypotheses/${target.hypothesis_id}` : '/hypotheses'
    case 'rollout': return target.hypothesis_id ? `/hypotheses/${target.hypothesis_id}` : '/hypotheses'
    case 'card': return target.category_id ? `/categories/${target.category_id}?tab=cards` : '/categories'
    case 'benchmark': return target.category_id ? `/categories/${target.category_id}?tab=benchmarks` : '/categories'
    default: return '/journal'
  }
}

// Оптимистичное удаление из списка
export function useOptimisticRemove(key, match) {
  const qc = useQueryClient()
  return {
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData(key)
      qc.setQueryData(key, (old) => Array.isArray(old) ? old.filter((x) => !match(x, id)) : old)
      return { prev }
    },
    onError: (e, id, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: key })
  }
}
