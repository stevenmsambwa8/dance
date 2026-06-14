'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

export default function AuthConfirm() {
  const router = useRouter()

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    // Read the page the user was on before clicking Google sign-in
    let returnTo = '/'
    try { returnTo = localStorage.getItem('auth_return_to') || '/' } catch {}
    try { localStorage.removeItem('auth_return_to') } catch {}

    if (!code) { router.replace(returnTo); return }

    supabase.auth.exchangeCodeForSession(code).then(() => {
      router.replace(returnTo)
    }).catch(() => {
      router.replace(returnTo)
    })
  }, [])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100dvh',
      background: 'var(--bg)',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font)',
      fontSize: 14,
      letterSpacing: 1,
    }}>
      Signing you in…
    </div>
  )
}
