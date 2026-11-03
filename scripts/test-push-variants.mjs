/**
 * Thử các biến thể VAPID để tìm lỗi `403 BadJwtToken` từ Apple.
 *
 *   node scripts/test-push-variants.mjs
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

const rows = await sql(`select endpoint, p256dh, auth from public.push_subscriptions limit 1;`)
if (!rows?.length) {
  console.log('Chưa có subscription nào.')
  process.exit(1)
}
const sub = rows[0]
const audienceFromEndpoint = new URL(sub.endpoint).origin
console.log('endpoint origin :', audienceFromEndpoint)

const webpush = (await import('web-push')).default

async function attempt(label, { subject, audience, expSeconds }) {
  let headers
  try {
    headers = webpush.getVapidHeaders(
      audience,
      subject,
      env.VITE_VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
      'aes128gcm',
      Math.floor(Date.now() / 1000) + expSeconds,
    )
  } catch (e) {
    console.log(`SKIP ${label} -> ${e.message}`)
    return
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        ...headers,
        TTL: '3600',
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
      },
      body: 'x'.repeat(16),
      signal: ctrl.signal,
    })
    const text = res.status === 201 ? '' : await res.text()
    console.log(`${res.status === 201 ? 'OK  ' : 'FAIL'} ${label} -> ${res.status} ${text.slice(0, 100)}`)
  } catch (e) {
    console.log(`FAIL ${label} -> ${e.message}`)
  } finally {
    clearTimeout(timer)
  }
}

console.log('')
await attempt('sub=https://app aud=origin exp=12h', {
  subject: 'https://comewithme1200.github.io/Memory/',
  audience: audienceFromEndpoint,
  expSeconds: 12 * 3600,
})
await attempt('sub=mailto:real aud=origin exp=12h', {
  subject: 'mailto:admin@gmail.com',
  audience: audienceFromEndpoint,
  expSeconds: 12 * 3600,
})
await attempt('sub=mailto:.local aud=origin exp=12h', {
  subject: 'mailto:admin@quanasang.local',
  audience: audienceFromEndpoint,
  expSeconds: 12 * 3600,
})
await attempt('sub=https://app aud=api.push.apple.com exp=12h', {
  subject: 'https://comewithme1200.github.io/Memory/',
  audience: 'https://api.push.apple.com',
  expSeconds: 12 * 3600,
})
await attempt('sub=https://app aud=origin exp=1h', {
  subject: 'https://comewithme1200.github.io/Memory/',
  audience: audienceFromEndpoint,
  expSeconds: 3600,
})
await attempt('sub=https://app aud=web.push.apple.com exp=12h', {
  subject: 'https://comewithme1200.github.io/Memory/',
  audience: 'https://web.push.apple.com',
  expSeconds: 12 * 3600,
})
