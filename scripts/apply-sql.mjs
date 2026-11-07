/**
 * Chạy 1 file .sql lên project Supabase qua Management API.
 *
 *   node scripts/apply-sql.mjs supabase/migration-pickup-time.sql
 *
 * Dùng cho các file migration trong thư mục `supabase/` — nhanh hơn việc
 * mở Dashboard -> SQL Editor -> dán -> Run.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const file = process.argv[2]
if (!file) {
  console.error('Dung: node scripts/apply-sql.mjs <duong-dan-file.sql>')
  process.exit(1)
}

const filePath = resolve(process.cwd(), file)
if (!existsSync(filePath)) {
  console.error('Khong tim thay file:', filePath)
  process.exit(1)
}
const sql = readFileSync(filePath, 'utf8')

// ---- .env ----
const env = {}
{
  const p = join(ROOT, '.env')
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

// ---- access token ----
let token = process.env.SUPABASE_ACCESS_TOKEN || ''
if (!token) {
  const p = join(ROOT, '.supabase-token')
  if (existsSync(p)) token = readFileSync(p, 'utf8').trim()
}
if (!token) {
  console.error('Chua co access token. Tao file .supabase-token oac dat SUPABASE_ACCESS_TOKEN.')
  process.exit(1)
}

const projectRef = env.VITE_SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
})

const text = await res.text()
console.log(`HTTP ${res.status}`)
if (!res.ok) {
  console.error(text)
  process.exit(1)
}
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2))
} catch {
  console.log(text)
}
