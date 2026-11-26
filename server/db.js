import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dataDir = path.join(root, 'data')
fs.mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(path.join(dataDir, 'lemma.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

// Нормализация параметров (undefined -> null) для node:sqlite
const norm = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a))
export const q = {
  run: (sql, ...args) => db.prepare(sql).run(...norm(args)),
  get: (sql, ...args) => { const r = db.prepare(sql).get(...norm(args)); return r ? { ...r } : undefined },
  all: (sql, ...args) => db.prepare(sql).all(...norm(args)).map((r) => ({ ...r }))
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cabinets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  seller TEXT, marketplace TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, cabinet_id TEXT NOT NULL, name TEXT NOT NULL,
  marketplace TEXT NOT NULL, icon TEXT, description TEXT, thesis TEXT,
  profile TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS benchmarks (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL, metric TEXT NOT NULL, unit TEXT,
  min REAL, max REAL, p10 REAL, p25 REAL, p50 REAL, p75 REAL, p90 REAL,
  leader REAL, seller REAL, higher_better INTEGER DEFAULT 1, bins TEXT NOT NULL DEFAULT '[]',
  sample INTEGER, period TEXT, source TEXT, method TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL, grp TEXT NOT NULL, title TEXT NOT NULL,
  detail TEXT, prevalence REAL, impact TEXT, source TEXT, sample INTEGER,
  period TEXT, method TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL,
  source TEXT, affected INTEGER DEFAULT 0, note TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
  price REAL, status TEXT DEFAULT 'active', metrics TEXT NOT NULL DEFAULT '{}', created_at TEXT
);
CREATE TABLE IF NOT EXISTS hypotheses (
  id TEXT PRIMARY KEY, cabinet_id TEXT NOT NULL, category_id TEXT NOT NULL,
  title TEXT NOT NULL, fact_kind TEXT, fact_ref TEXT, fact_text TEXT,
  funnel_stage TEXT, expected_rub REAL, priority TEXT DEFAULT 'mid',
  status TEXT DEFAULT 'new', origin TEXT DEFAULT 'user', card_ids TEXT DEFAULT '[]',
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY, hypothesis_id TEXT NOT NULL, metric TEXT, baseline REAL,
  mde REAL, alpha REAL DEFAULT 0.05, power REAL DEFAULT 0.8,
  required_n INTEGER, current_n INTEGER DEFAULT 0, start_date TEXT, end_date TEXT,
  status TEXT DEFAULT 'draft', warnings TEXT DEFAULT '[]', planned TEXT DEFAULT '{}', created_at TEXT
);
CREATE TABLE IF NOT EXISTS interpretations (
  id TEXT PRIMARY KEY, test_id TEXT NOT NULL, verdict TEXT, summary TEXT,
  effects TEXT DEFAULT '[]', controls TEXT DEFAULT '[]', effect_rub REAL,
  decided TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS rollouts (
  id TEXT PRIMARY KEY, hypothesis_id TEXT NOT NULL, status TEXT DEFAULT 'active',
  control_ids TEXT DEFAULT '[]', waves TEXT DEFAULT '[]', series TEXT DEFAULT '{}', created_at TEXT
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY, cabinet_id TEXT NOT NULL, actor TEXT DEFAULT 'agent',
  type TEXT NOT NULL, title TEXT NOT NULL, note TEXT, target TEXT DEFAULT '{}',
  payload TEXT, provenance TEXT, created_at TEXT NOT NULL, undone_at TEXT
);
CREATE TABLE IF NOT EXISTS daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cabinet_id TEXT NOT NULL, date TEXT NOT NULL,
  revenue REAL, orders INTEGER, sessions INTEGER, conv REAL, ad_share REAL
);
CREATE INDEX IF NOT EXISTS idx_cat_cab ON categories(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_bench_cat ON benchmarks(category_id);
CREATE INDEX IF NOT EXISTS idx_hyp_cab ON hypotheses(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_act_cab ON actions(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_daily_cab ON daily(cabinet_id);
`)

export const uid = () => crypto.randomUUID().slice(0, 8) + crypto.randomUUID().slice(0, 4)
export const now = () => new Date().toISOString()
export const J = (v, fallback = null) => { try { return v == null ? fallback : JSON.parse(v) } catch { return fallback } }
export const S = (v) => JSON.stringify(v ?? null)

export function parseRow(row, jsonFields = []) {
  if (!row) return row
  const out = { ...row }
  for (const f of jsonFields) out[f] = J(row[f], f === 'bins' || f === 'effects' || f === 'controls' || f === 'waves' || f === 'card_ids' || f === 'control_ids' || f === 'warnings' ? [] : {})
  return out
}
