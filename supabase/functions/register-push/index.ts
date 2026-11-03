/**
 * Edge Function: `register-push`
 *
 * Lưu push subscription của thiết bị vào DB để server có thể gửi thông báo
 * khi có đơn mới (kể cả khi điện thoại đã khoá màn hình).
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN FUNCTION NÀY?
 *
 * RLS của bảng `push_subscriptions` KHÔNG cho phép `anon`/`authenticated`
 * INSERT (chống spam). Nhưng client cần gửi subscription lên.
 * Giải pháp: client gọi Edge Function này kèm JWT của chủ quán; function
 * xác thực token rồi ghi bằng service_role (tự bypass RLS).
 *
 * ---------------------------------------------------------------------------
 * GỌI TỪ CLIENT
 *
 *   const { data } = await supabase.functions.invoke('register-push', {
 *     body: { subscription, userAgent, platform },
 *   })
 *
 * Function tự đọc JWT từ header `Authorization` (do Supabase SDK gửi kèm).
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

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

Deno.serve(async (req) => {
  // Preflight cho CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Chỉ chấp nhận POST.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Client gọi function này bằng anon key + JWT của chủ quán (Supabase SDK
    // tự gắn). Vì vậy `auth.getUser(token)` dùng anon key là đủ.
    const admin = createClient(supabaseUrl, serviceRoleKey)

    // Token của chủ quán (gửi tự động bởi Supabase SDK khi đã đăng nhập).
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return json({ error: 'Thiếu token xác thực.' }, 401)
    }

    // Xác thực token -> lấy user_id.
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: userData, error: userErr } = await authClient.auth.getUser(token)
    if (userErr || !userData?.user) {
      return json({ error: 'Token không hợp lệ hoặc đã hết hạn.' }, 401)
    }
    const userId = userData.user.id

    // Đọc body.
    const body = await req.json().catch(() => null)
    const sub = body?.subscription
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return json({ error: 'Subscription không hợp lệ.' }, 400)
    }

    // --- Ghi subscription ---
    //
    // Dùng service_role -> TỰ BYPASS RLS, nên insert thẳng vào bảng được,
    // không cần RPC `upsert_push_subscription` phải tồn tại trong DB.
    //
    // Vì sao không dùng RPC?
    //   - RPC chỉ là đường dự phòng cho client gọi trực tiếp (bản `anon`/
    //     `authenticated` không được INSERT để chống spam).
    //   - Nếu bắt buộc phải có RPC thì Edge Function sẽ hỏng mỗi khi
    //     migration SQL chưa được chạy -> khó chẩn đoán.
    //   - Ở đây ta là fallback: thử RPC trước, nếu lỗi "does not exist"
    //     thì ghi thẳng bằng service_role.
    const row = {
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_id: userId,
      user_agent: String(body?.userAgent || '').slice(0, 500) || null,
      platform: String(body?.platform || '').slice(0, 100) || null,
      updated_at: new Date().toISOString(),
    }

    let saved = false
    let savedId = null

    // Cách 1: RPC (nếu DB có).
    const { data: rpcData, error: rpcErr } = await admin.rpc('upsert_push_subscription', {
      p_endpoint: row.endpoint,
      p_p256dh: row.p256dh,
      p_auth_key: row.auth,
      p_user_id: row.user_id,
      p_user_agent: row.user_agent,
      p_platform: row.platform,
    })

    if (!rpcErr) {
      saved = true
      savedId = rpcData?.id ?? null
    } else {
      console.warn('RPC upsert_push_subscription không dùng được:', rpcErr.message)

      // Cách 2: insert thẳng bằng service_role (bypass RLS).
      const { data: upsertData, error: upsertErr } = await admin
        .from('push_subscriptions')
        .upsert(row, { onConflict: 'endpoint' })
        .select('id')
        .single()

      if (upsertErr) {
        console.error('Lỗi ghi subscription:', upsertErr)
        return json({ error: upsertErr.message }, 500)
      }
      saved = true
      savedId = upsertData?.id ?? null
    }

    console.log(`✓ Đã đăng ký push cho user ${userId} (id=${savedId})`)
    return json({ ok: true, id: savedId })
  } catch (e) {
    console.error('register-push lỗi:', e)
    return json({ error: e?.message || 'Lỗi không xác định.' }, 500)
  }
})
