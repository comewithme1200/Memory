import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase.js'

/* ------------------------------------------------------------------ *
 * Quản lý phiên đăng nhập của chủ quán
 *
 * - Có Supabase  : dùng Supabase Auth (email + mật khẩu) -> RLS chặn
 *                  truy cập dữ liệu quản trị cho người chưa đăng nhập.
 * - Chưa có      : chế độ demo, dùng PIN lưu trong sessionStorage.
 *                  CHỈ dùng để thử, KHÔNG phải bảo mật thật.
 * ------------------------------------------------------------------ */

const PIN_SESSION_KEY = 'quan-an-sang:admin-pin'
const DEMO_PIN = import.meta.env.VITE_ADMIN_PIN || '1234'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pinOk, setPinOk] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setPinOk(sessionStorage.getItem(PIN_SESSION_KEY) === '1')
      setLoading(false)
      return
    }

    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email, password) => {
    if (!supabase) {
      throw new Error('Chưa cấu hình Supabase. Hãy dùng chế độ PIN hoặc kết nối Supabase.')
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signInWithPin = useCallback((pin) => {
    if (String(pin).trim() !== DEMO_PIN) {
      throw new Error('Mã PIN không đúng.')
    }
    sessionStorage.setItem(PIN_SESSION_KEY, '1')
    setPinOk(true)
  }, [])

  const signOut = useCallback(async () => {
    sessionStorage.removeItem(PIN_SESSION_KEY)
    setPinOk(false)
    if (supabase) await supabase.auth.signOut()
    setSession(null)
  }, [])

  const value = useMemo(
    () => ({
      session,
      loading,
      isAuthenticated: isSupabaseConfigured ? Boolean(session) : pinOk,
      email: session?.user?.email || (pinOk ? 'Chủ quán (chế độ demo)' : null),
      isDemoMode: !isSupabaseConfigured,
      demoPin: DEMO_PIN,
      signIn,
      signInWithPin,
      signOut,
    }),
    [session, loading, pinOk, signIn, signInWithPin, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>')
  return ctx
}
