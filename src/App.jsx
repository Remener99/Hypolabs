import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, setToken } from './api.js'
import { ToastProvider, Skeleton, Icon, Button } from './ui.jsx'
import { Shell } from './layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Categories from './pages/Categories.jsx'
import CategoryDetail from './pages/CategoryDetail.jsx'
import Hypotheses from './pages/Hypotheses.jsx'
import HypothesisDetail from './pages/HypothesisDetail.jsx'
import Journal from './pages/Journal.jsx'

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15000, retry: (n, e) => e instanceof ApiError && e.status === 401 ? false : n < 2, refetchOnWindowFocus: false }
  }
})

function Splash() {
  return (
    <div className="splash">
      <div className="col aic gap16">
        <span className="logo-mark" style={{ width: 44, height: 44, borderRadius: 12 }}>
          <svg width="22" height="22" viewBox="0 0 32 32"><rect x="6" y="17" width="4.5" height="9" rx="1" fill="#fff" opacity=".5"/><rect x="13.5" y="11" width="4.5" height="15" rx="1" fill="#fff" opacity=".75"/><rect x="21" y="6" width="4.5" height="20" rx="1" fill="#fff"/></svg>
        </span>
        <Skeleton w={180} h={12} />
      </div>
    </div>
  )
}

// Оба гейта принимают решение по одному признаку — наличию пользователя.
// Ошибка фонового перезапроса не выкидывает из приложения и не создаёт цикл редиректов.
function RequireAuth({ children }) {
  const loc = useLocation()
  const { data, isPending } = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me') })
  if (isPending) return <Splash />
  if (!data?.user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return children
}
function LoginGate() {
  const { data, isPending } = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me'), retry: false })
  if (isPending) return <Splash />
  if (data?.user) return <Navigate to="/" replace />
  return <Login />
}

// Слушаем централизованный 401 и аккуратно сбрасываем сессию
function AuthListener() {
  const qc = useQueryClient()
  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null)
      // Помечаем сессию пустой — гейты уведут на экран входа.
      // Не делаем qc.clear(): это удалило бы активный запрос me и вызвало цикл.
      qc.setQueryData(['me'], null)
    }
    window.addEventListener('lemma:unauthorized', onUnauthorized)
    return () => window.removeEventListener('lemma:unauthorized', onUnauthorized)
  }, [qc])
  return null
}

// Никогда не оставляем белый экран: показываем ошибку и кнопку перезагрузки
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('Лемма: ошибка рендера', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="splash">
          <div className="tile tile-pad" style={{ maxWidth: 460, margin: 16 }}>
            <div className="flex aic gap8 mb12"><Icon name="alert" size={18} style={{ color: 'var(--danger)' }} /><h2>Что-то пошло не так</h2></div>
            <div className="small muted mb16" style={{ lineHeight: 1.5 }}>
              Приложение столкнулось с ошибкой и не смогло отрисовать экран. Перезагрузите страницу — если повторится, пришлите текст ниже.
            </div>
            <pre className="tiny" style={{ background: 'var(--panel)', border: '1px solid var(--line-soft)', borderRadius: 8, padding: 10, overflow: 'auto', maxHeight: 140, whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message || this.state.error)}</pre>
            <div className="mt16"><Button variant="primary" icon="undo" onClick={() => window.location.reload()}>Перезагрузить</Button></div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ErrorBoundary>
        <AuthListener />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginGate />} />
            <Route element={<RequireAuth><Shell /></RequireAuth>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/categories/:id" element={<CategoryDetail />} />
              <Route path="/hypotheses" element={<Hypotheses />} />
              <Route path="/hypotheses/:id" element={<HypothesisDetail />} />
              <Route path="/journal" element={<Journal />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        </ErrorBoundary>
      </ToastProvider>
    </QueryClientProvider>
  )
}
