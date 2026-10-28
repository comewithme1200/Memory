/**
 * Liệt kê món ăn + gợi ý nhóm tuỳ chọn phù hợp, để viết SQL seed.
 *   node scripts/list-menu.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || ''
const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const { data, error } = await s.from('menu_items').select('id,name,price,sort_order').order('sort_order')
if (error) {
  console.log('Lỗi:', error.message)
  process.exit(1)
}
for (const m of data) {
  const isMain = /phở|bún|com|cơm|mì|cháo|xôi/i.test(m.name)
  const hasSize = isMain || /cà phê|nước mía|bia|trà|sữa|sinh tố/i.test(m.name)
  console.log(`${m.id}  ${m.name}  ${m.price}  size=${hasSize} required=${isMain}`)
}
