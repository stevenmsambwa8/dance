'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DMError({ error, reset }) {
  const router = useRouter()

  useEffect(() => {
    console.error('[DM] Route error:', error)
  }, [error])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60vh', padding: '24px 16px',
      gap: 16, textAlign: 'center',
    }}>
      <i className="ri-error-warning-line" style={{ fontSize: 36, color: '#f87171' }} />
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
        Something went wrong
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, maxWidth: 280 }}>
        {error?.message || 'An unexpected error occurred in this conversation.'}
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          onClick={reset}
          style={{
            padding: '9px 18px', borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)', fontSize: 13,
            fontWeight: 500, cursor: 'pointer',
          }}
        >
          Try again
        </button>
        <button
          onClick={() => router.back()}
          style={{
            padding: '9px 18px', borderRadius: 10, border: 'none',
            background: 'var(--accent)', color: '#fff', fontSize: 13,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          Go back
        </button>
      </div>
    </div>
  )
}
