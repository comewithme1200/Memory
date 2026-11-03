/**
 * Edge Function: `send-push`
 *
 * Gửi thông báo "đơn mới" tới mọi thiết bị đã đăng ký Web Push.
 *
 * ---------------------------------------------------------------------------
 * KHI NÀO ĐƯỢC GỌI?
 *
 * Tự động (nếu đã chạy `npm run setup:push`):
 *   Database trigger `trg_push_new_order` trên bảng `orders` (sau INSERT)
 *   -> `pg_net` gọi HTTP tới function này.
 *
 * Thủ công (để test):
 *   Gọi trực tiếp:
 *     curl -X POST \
 *       https://<project>.supabase.co/functions/v1/send-push \
 *       -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
 *       -H "Content-Type: application/json" \
 *       -d '{"order":{"code":"A001","customer_name":"Nam","customer_phone":"0909..."}}'
 *
 * ---------------------------------------------------------------------------
 * WEB PUSH LÀ GÌ?
 *
 * Giao thức Web Push (RFC 8030) dùng 1 cặp khoá VAPID để mã hoá payload
 * bằng ECDH + AES-128-GCM. Mỗi thiết bị có 1 "endpoint" riêng — server gửi
 * POST (mã hoá) tới endpoint đó, dịch vụ push của trình duyệt giải mã và
 * hiển thị thông báo.
 *
 * Thư viện `web-push` (npm) làm sẵn phần mã hoá -> ta chỉ cần:
 *   1. Đọc danh sách subscription từ DB.
 *   2. `webpush.sendNotification(sub, payload, { vapidDetails })`.
 *   3. Xoá subscription nếu server trả 404/410 (thiết bị đã gỡ app).
 *
 * ---------------------------------------------------------------------------
 * SECRET CẦN ĐẶT (Supabase Dashboard -> Edge Functions -> Secrets)
 *
 *   VAPID_PUBLIC_KEY   = <public key>   (giống VITE_VAPID_PUBLIC_KEY ở .env)
 *   VAPID_PRIVATE_KEY  = <private key>  (BÍ MẬT — sinh bằng
 *                       `node scripts/generate-vapid-keys.mjs`)
 *   APP_URL            = <url web app>  (VD: https://comewithme1200.github.io/Memory/)
 *                       Dùng để thông báo trỏ đúng app khi bấm vào.
 *
 * `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` do
 * Supabase tự cấp sẵn cho Edge Function.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Dựng nội dung thông báo từ đơn hàng.
 *
 * @param {object} order  dòng đơn hàng
 * @param {string} appUrl  địa chỉ web app (bấm thông báo -> mở đúng trang)
 */
function buildPayload(order, appUrl) {
  const who = (order.customer_name || '').trim() || 'Khách'
  const phone = (order.customer_phone || '').trim()
  const total = Number(order.total || 0)

  const lines = [who]
  if (phone) lines.push(`SĐT ${phone}`)
  if (total > 0) lines.push(`Tổng ${total.toLocaleString('vi-VN')}đ`)

  return {
    title: order.code ? `🔔 Đơn mới! #${order.code}` : '🔔 Đơn mới!',
    body: lines.join(' · '),
    tag: `order-${order.id || order.code || 'new'}`,
    url: `${appUrl}#/quan-tri/orders`,
    icon: `${appUrl}icon-192.png`,
    badge: `${appUrl}icon-192.png`,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

    // URL của web app (GitHub Pages). Dùng để thông báo trỏ đúng app.
    // Fallback về URL Supabase nếu quên đặt secret.
    const appUrl = (Deno.env.get('APP_URL') || supabaseUrl).replace(/\/$/, '') + '/'

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('❌ Thiếu VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY trong Secrets.')
      return json(
        { error: 'Thiếu VAPID keys. Xem README -> Bước 2i.' },
        500,
      )
    }

    // `sub` trong JWT VAPID PHẢI là URL https: hoặc mailto: hợp lệ.
    // Apple cảnh báo subject kiểu `localhost` / domain không thật sẽ gây
    // `403 BadJwtToken` -> dùng chính URL của web app (luôn hợp lệ).
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || `${appUrl}`

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    // --- Đọc đơn hàng cần báo ---
    let order = null
    if (req.method === 'POST') {
      const body = await req.json().catch(() => null)
      // Webhook gửi: { type, table, record, old_record }
      // Test thủ công gửi: { order: {...} }
      order = body?.order || body?.record || null
      console.log('📥 Payload nhận được:', JSON.stringify(body).slice(0, 500))
    }

    // Nếu không có đơn trong body -> lấy đơn `new` mới nhất trong hôm nay.
    const admin = createClient(supabaseUrl, serviceRoleKey)
    if (!order) {
      const { data } = await admin
        .from('orders')
        .select('*')
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(1)
      order = data?.[0] || null
    }

    if (!order) {
      return json({ ok: true, sent: 0, message: 'Không có đơn mới để báo.' })
    }

    const payload = buildPayload(order, appUrl)

    // --- Lấy danh sách thiết bị ---
    const { data: subs, error: subErr } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')

    if (subErr) {
      console.error('Lỗi đọc subscriptions:', subErr)
      return json({ error: subErr.message }, 500)
    }

    if (!subs || subs.length === 0) {
      console.log('Không có thiết bị nào đăng ký push.')
      return json({ ok: true, sent: 0, message: 'Chưa có thiết bị đăng ký push.' })
    }

    // --- Gửi ---
    let sent = 0
    let failed = 0
    const staleIds = []

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            JSON.stringify(payload),
            { TTL: 3600, urgency: 'high' },
          )
          sent++
        } catch (e) {
          failed++
          const status = e?.statusCode
          const apnsId = e?.headers?.['apns-id'] || ''

          // Apple trả body JSON: { "reason": "BadJwtToken" | "VapidPkHashMismatch" | ... }
          let reason = ''
          try {
            reason = JSON.parse(e?.body || '{}')?.reason || ''
          } catch {
            reason = String(e?.body || '').slice(0, 120)
          }

          // 404/410 -> thiết bị đã gỡ app / token hết hạn -> xoá subscription.
          // 403 + VapidPkHashMismatch -> subscription được tạo bằng VAPID key CŨ
          //   (đã xoay khoá) -> cũng phải xoá, nếu không sẽ gửi hỏng mãi.
          if (status === 404 || status === 410 || reason === 'VapidPkHashMismatch') {
            staleIds.push(s.id)
          }
          console.error(
            `✗ Gửi push thất bại (${status || '?'}${reason ? ' ' + reason : ''}) apns-id=${apnsId}: ${e?.message}`,
          )
        }
      }),
    )

    // Dọn subscription chết.
    if (staleIds.length > 0) {
      await admin.from('push_subscriptions').delete().in('id', staleIds)
      console.log(`🧹 Đã xoá ${staleIds.length} subscription không còn dùng.`)
    }

    console.log(`✓ Đã gửi ${sent}/${subs.length} thông báo đơn mới.`)
    return json({ ok: true, sent, failed, total: subs.length })  } catch (e) {
    console.error('send-push lỗi:', e)
    return json({ error: e?.message || 'Lỗi không xác định.' }, 500)
  }
})
