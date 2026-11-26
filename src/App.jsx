import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api.js'
import { ToastProvider, Skeleton } from './ui.jsx'
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

function RequireAuth({ children }) {
  const loc = useLocation()
  const { data, isLoading, error } = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me') })
  if (isLoading) return <Splash />
  if (error || !data?.user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return children
}
function LoginGate() {
  const { data, isLoading } = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me'), retry: false })
  if (isLoading) return <Splash />
  if (data?.user) return <Navigate to="/" replace />
  return <Login />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
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
      </ToastProvider>
    </QueryClientProvider>
  )
}
