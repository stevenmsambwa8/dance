'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

export default function AuthConfirm() {
  const router = useRouter()

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) { router.replace('/'); return }

    supabase.auth.exchangeCodeForSession(code).then(() => {
      router.replace('/')
    }).catch(() => {
      router.replace('/login')
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
