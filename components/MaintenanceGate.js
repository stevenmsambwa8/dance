'use client'
import { useAuth } from './AuthProvider'
import { useTheme } from './ThemeProvider'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const MAINTENANCE_END = new Date('2026-07-02T00:00:00')

function useCountdown(target) {
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, target - Date.now()))
  useEffect(() => {
    const tick = () => setTimeLeft(Math.max(0, target - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])
  const total   = Math.floor(timeLeft / 1000)
  const days    = Math.floor(total / 86400)
  const hours   = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return { days, hours, minutes, seconds }
}

function Pad({ value, label }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '14px',
        padding: 'clamp(10px, 3vw, 14px) clamp(12px, 4vw, 18px)',
        fontSize: 'clamp(1.5rem, 6vw, 2rem)',
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--text)',
        minWidth: 'clamp(52px, 16vw, 68px)',
        textAlign: 'center',
        letterSpacing: '-1px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}>
        {String(value).padStart(2, '0')}
      </div>
      <span style={{
        fontSize: 'clamp(0.55rem, 2vw, 0.65rem)',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '1.2px',
        fontWeight: 600,
      }}>
        {label}
      </span>
    </div>
  )
}

export default function MaintainanceGate({ children }) {
  const { isAdmin, loading } = useAuth()
  const { theme, toggle } = useTheme()
  const { days, hours, minutes, seconds } = useCountdown(MAINTENANCE_END.getTime())
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError]     = useState('')

  const isUnderMaintenance = new Date() < MAINTENANCE_END

  // ── Kill all realtime activity while gate is visible ─────────────
  useEffect(() => {
    if (!isUnderMaintenance || isAdmin || loading) return
    // Remove all active Supabase channels so no presence/notifications fire
    supabase.getChannels().forEach(ch => supabase.removeChannel(ch))
  }, [isUnderMaintenance, isAdmin, loading])

  if (loading) return null
  if (!isUnderMaintenance || isAdmin) return children

  async function handleGoogleSignIn() {
    setGoogleError('')
    setGoogleLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
    } catch (err) {
      setGoogleError(err.message)
      setGoogleLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      color: 'var(--text)',
      textAlign: 'center',
      padding: 'clamp(1.5rem, 6vw, 2.5rem)',
      fontFamily: "'Inter', -apple-system, sans-serif",
      gap: 'clamp(1.25rem, 4vw, 2rem)',
      position: 'relative',
      boxSizing: 'border-box',
    }}>

      {/* ── Theme toggle ── */}
      <button
        onClick={toggle}
        aria-label="Toggle theme"
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: '1.1rem',
          color: 'var(--text-dim)',
          flexShrink: 0,
        }}
      >
        <i className={theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line'} />
      </button>

      {/* ── Icon ── */}
     <div
  style={{
    fontSize: 'clamp(2.5rem, 10vw, 3.5rem)',
    lineHeight: 1
  }}
>
  <img
  src="/logo.png"
  alt="Logo"
  style={{
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    objectFit: 'cover'
  }}
/>
</div>
      {/* ── Heading ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '340px', width: '100%' }}>
        <h1 style={{
          fontSize: 'clamp(1.4rem, 6vw, 1.85rem)',
          fontWeight: 800,
          letterSpacing: '-0.5px',
          color: 'var(--text)',
          lineHeight: 1.2,
        }}>
          Nabogaming is upgrading
        </h1>
        <p style={{
          color: 'var(--text-muted)',
          fontSize: 'clamp(0.85rem, 3.5vw, 0.95rem)',
          lineHeight: 1.6,
        }}>
          We're working on something better. Back on{' '}
          <strong style={{ color: 'var(--accent)' }}>June 7</strong> 2026.
        </p>
      </div>

      {/* ── Countdown ── */}
      <div style={{
        display: 'flex',
        gap: 'clamp(6px, 2vw, 12px)',
        alignItems: 'flex-start',
        width: '100%',
        maxWidth: '360px',
        justifyContent: 'center',
      }}>
        <Pad value={days}    label="Days"    />
        <span style={{ fontSize: 'clamp(1.4rem, 5vw, 1.8rem)', fontWeight: 700, color: 'var(--border-dark)', marginTop: '10px' }}>:</span>
        <Pad value={hours}   label="Hours"   />
        <span style={{ fontSize: 'clamp(1.4rem, 5vw, 1.8rem)', fontWeight: 700, color: 'var(--border-dark)', marginTop: '10px' }}>:</span>
        <Pad value={minutes} label="Minutes" />
        <span style={{ fontSize: 'clamp(1.4rem, 5vw, 1.8rem)', fontWeight: 700, color: 'var(--border-dark)', marginTop: '10px' }}>:</span>
        <Pad value={seconds} label="Seconds" />
      </div>

      {/* ── Admin Google sign-in ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '300px' }}>
        <button
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            width: '100%',
            padding: '12px 20px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            color: 'var(--text)',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: googleLoading ? 'not-allowed' : 'pointer',
            opacity: googleLoading ? 0.6 : 1,
            fontFamily: 'inherit',
            transition: 'opacity 0.2s',
          }}
        >
          <i className="ri-google-fill" style={{ fontSize: '1.1rem', color: '#4285F4' }} />
          {googleLoading ? 'Signing in…' : 'Admin sign in'}
        </button>
        {googleError && (
          <p style={{ color: '#ef4444', fontSize: '0.8rem', margin: 0 }}>{googleError}</p>
        )}
      </div>

      {/* ── Accent bar ── */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '3px',
        background: 'var(--accent)',
      }} />
    </div>
  )
}
