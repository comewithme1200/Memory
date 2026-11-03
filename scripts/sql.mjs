/**
 * Chạy 1 câu SQL tự do trên project Supabase qua Management API.
 *
 * Dùng để debug nhanh các lệnh SQL mà `npm run setup:push` chạy.
 *
 *   node scripts/sql.mjs "select 1;"
 *   node scripts/sql.mjs "select * from public.push_subscriptions;"
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const sql = process.argv.slice(2).join(' ')
if (!sql) {
  console.error('Dung: node scripts/sql.mjs "<SQL>"')
  process.exit(1)
}

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

let token = process.env.SUPABASE_ACCESS_TOKEN || ''
if (!token) {
  const p = join(ROOT, '.supabase-token')
  if (existsSync(p)) token = readFileSync(p, 'utf8').trim()
}
if (!token) {
  console.error('Chua co access token. Tao file .supabase-token hoac dat SUPABASE_ACCESS_TOKEN.')
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
