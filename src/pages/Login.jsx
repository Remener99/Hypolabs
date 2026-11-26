import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, setToken } from '../api.js'
import { Icon, Field, Input, Button, useToast } from '../ui.jsx'

export default function Login() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [mode, setMode] = useState('login')
  const [f, setF] = useState({ email: '', password: '', name: '' })
  const [error, setError] = useState('')

  const auth = useMutation({
    mutationFn: ({ path, body }) => api(path, { method: 'POST', body }),
    onSuccess: (data) => {
      setToken(data.token)
      qc.setQueryData(['me'], { user: data.user })
      qc.invalidateQueries()
      nav('/')
    },
    onError: (e) => setError(e.message)
  })
  const submit = (e) => {
    e?.preventDefault()
    setError('')
    auth.mutate({ path: mode === 'login' ? '/auth/login' : '/auth/register', body: f })
  }
  const demo = () => {
    setError('')
    auth.mutate({ path: '/auth/login', body: { email: 'demo@lemma.ru', password: 'lemma2026' } })
  }

  return (
    <div className="login-page">
      <div className="login-side">
        <div className="flex aic gap12">
          <span className="logo-mark" style={{ background: 'rgba(255,255,255,.14)' }}>
            <svg width="16" height="16" viewBox="0 0 32 32"><rect x="6" y="17" width="4.5" height="9" rx="1" fill="#fff" opacity=".5"/><rect x="13.5" y="11" width="4.5" height="15" rx="1" fill="#fff" opacity=".75"/><rect x="21" y="6" width="4.5" height="20" rx="1" fill="#fff"/></svg>
          </span>
          <span style={{ fontSize: 19, fontWeight: 700 }}>Лемма</span>
        </div>
        <div style={{ marginTop: 56 }}>
          <h1>Рост начинается<br />с знания о категории</h1>
          <div className="sub">Каждая категория маркетплейса живёт по своим правилам. Лемма держит бенчмарки и паттерны лидеров, а агент превращает разрывы в проверенные результаты.</div>
          <div className="mt24">
            <div className="login-point"><Icon name="dashboard" size={16} /><span>Бенчмарки с вашей позицией на шкале — сразу видно, где вы в норме, а где выпали.</span></div>
            <div className="login-point"><Icon name="flask" size={16} /><span>Цепочка без разрывов: факт → гипотеза → тест → интерпретация → откат или волны.</span></div>
            <div className="login-point"><Icon name="undo" size={16} /><span>Каждое действие агента прозрачно: как получено, и откат в один клик.</span></div>
          </div>
        </div>
        <div className="login-illu">
          <svg width="100%" height="120" viewBox="0 0 420 120" style={{ maxWidth: 420 }}>
            {Array.from({ length: 24 }, (_, i) => {
              const h = Math.exp(-((i - 13) ** 2) / 30) * 62 + 6
              return <rect key={i} x={10 + i * 16.5} y={92 - h} width={12} height={h} rx="2" fill="#fff" opacity={i >= 9 && i <= 17 ? 0.38 : 0.14} />
            })}
            <line x1="10" x2="404" y1="92" y2="92" stroke="#fff" strokeOpacity=".4" strokeWidth="1.5" />
            <line x1="122" x2="122" y1="24" y2="92" stroke="#fff" strokeWidth="2" />
            <circle cx="122" cy="92" r="4" fill="#fff" />
            <rect x="86" y="6" width="72" height="20" rx="6" fill="#fff" />
            <text x="122" y="20" textAnchor="middle" fontSize="11" fontWeight="650" fill="#2F4F4F">вы · 3,9%</text>
            <text x="330" y="108" fontSize="10" fill="#fff" opacity=".65">норма категории →</text>
          </svg>
        </div>
      </div>
      <div className="login-form-side">
        <form className="login-card" onSubmit={submit}>
          <h1 style={{ fontSize: 24 }}>{mode === 'login' ? 'Вход в кабинет' : 'Создать аккаунт'}</h1>
          <div className="muted small mt8 mb16">{mode === 'login' ? 'Продавцы и агентства: свои категории, свои бенчмарки.' : 'Пустой кабинет — категории и бенчмарки добавите сами.'}</div>
          <div className="col gap12">
            {mode === 'register' && <Field label="Имя"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Как к вам обращаться" autoComplete="name" /></Field>}
            <Field label="Почта"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@company.ru" autoComplete="email" /></Field>
            <Field label="Пароль"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Field>
            {error && <div className="warn-box"><Icon name="alert" size={15} /><span>{error}</span></div>}
            <Button variant="primary" className="block" type="submit" disabled={auth.isPending}>{auth.isPending ? 'Секунду…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</Button>
            <button type="button" className="how-btn" style={{ alignSelf: 'center', fontSize: 12.5 }} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
              {mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
            </button>
          </div>
          <div className="demo-box">
            <div className="mb8">Демо-кабинет мебельного продавца: 3 категории с разными профилями, 5 гипотез, идущий тест и раскатка на 11 артикулов.</div>
            <Button size="sm" variant="soft" icon="play" type="button" onClick={demo} disabled={auth.isPending}>Войти в демо</Button>
            <span className="tiny faint" style={{ marginLeft: 10 }}>demo@lemma.ru · lemma2026</span>
          </div>
        </form>
      </div>
    </div>
  )
}
