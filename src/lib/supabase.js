import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Cắt bỏ đuôi "/rest/v1" nếu có: supabase-js tự thêm "/rest/v1" vào URL,
// nếu không sẽ thành "/rest/v1/rest/v1/..." và mọi truy vấn đều lỗi.
const url = rawUrl ? rawUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '') : ''

// Chỉ tạo client khi có đủ thông tin. Nếu thiếu thì app chạy ở chế độ "local"
// (dữ liệu lưu trong localStorage của trình duyệt) để chủ quán dùng thử ngay.
export const SUPABASE_URL = url
export const SUPABASE_ANON_KEY = key || ''
export const isSupabaseConfigured = Boolean(url && key && url.startsWith('http'))

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null
