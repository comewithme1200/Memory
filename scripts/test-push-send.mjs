/**
 * Gửi thử 1 push tới thiết bị đã đăng ký, in ra LỖI CHI TIẾT.
 *
 * Dùng để debug khi Edge Function báo `failed: 1` mà không nói lý do.
 *
 *   node scripts/test-push-send.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const env = {}
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const token = existsSync(join(ROOT, '.supabase-token'))
  ? readFileSync(join(ROOT, '.supabase-token'), 'utf8').trim()
  : ''
const projectRef = env.VITE_SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text)
  return JSON.parse(text)
}

const rows = await sql(
  `select endpoint, p256dh, auth from public.push_subscriptions limit 1;`,
)
if (!rows?.length) {
  console.log('Chưa có subscription nào.')
  process.exit(1)
}
const sub = rows[0]

const webpush = (await import('web-push')).default
webpush.setVapidDetails(
  'mailto:admin@quanasang.local',
  env.VITE_VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY,
)

const payload = JSON.stringify({
  title: '🔔 Đơn mới! #TEST',
  body: 'Thử gửi thử (debug)',
  tag: 'test-debug',
  url: `${env.VITE_APP_URL || ''}#/quan-tri/orders`,
})

try {
  const res = await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
    { TTL: 3600, urgency: 'high' },
  )
  console.log('✅ Gửi thành công:', res.statusCode, res.headers?.location || '')
} catch (e) {
  console.log('❌ LỖI CHI TIẾT:')
  console.log('   name       :', e?.name)
  console.log('   message    :', e?.message)
  console.log('   statusCode :', e?.statusCode)
  console.log('   body       :', e?.body)
  console.log('   headers    :', JSON.stringify(e?.headers))
}
