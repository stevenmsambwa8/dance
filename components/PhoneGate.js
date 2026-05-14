'use client'
import { useState, useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'

export default function PhoneGate() {
  const { user, profile } = useAuth()
  const [show, setShow]     = useState(false)
  const [code, setCode]     = useState('255')
  const [phone, setPhone]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    // Show only when logged in and profile loaded but no phone saved
    if (user && profile && !profile.phone) {
      setShow(true)
    } else {
      setShow(false)
    }
  }, [user, profile])

  async function save() {
    const cleaned = phone.trim()
    if (!cleaned) { setError('Please enter your phone number.'); return }
    if (cleaned.length < 6) { setError('Enter a valid phone number.'); return }
    const full = `+${code}${cleaned.replace(/^0/, '')}`
    setSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('profiles')
      .update({ phone: full })
      .eq('id', user.id)
    if (err) {
      setError('Failed to save. Try again.')
      setSaving(false)
      return
    }
    setShow(false)
    setSaving(false)
  }

  if (!show) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'var(--bg)',
        borderRadius: 20,
        padding: '32px 24px',
        width: '100%',
        maxWidth: 360,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        border: '1px solid var(--border)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Icon */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'color-mix(in srgb, var(--accent) 10%, var(--bg))',
            border: '1.5px solid var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, color: 'var(--accent)',
          }}>
            <i className="ri-phone-line" />
          </div>
        </div>

        {/* Text */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px' }}>
            One last thing
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Add your phone number so we can reach you for match confirmations and payouts.
          </p>
        </div>

        {/* Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Country code buttons */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            {[
              { code: '254', flag: '/kenya.png',    label: '+254' },
              { code: '255', flag: '/tanzania.png', label: '+255' },
              { code: '256', flag: '/uganda.png',   label: '+256' },
            ].map(c => (
              <button
                key={c.code}
                type="button"
                onClick={() => setCode(c.code)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 99,
                  border: `1.5px solid ${code === c.code ? 'var(--accent)' : 'var(--border)'}`,
                  background: code === c.code ? 'color-mix(in srgb, var(--accent) 8%, var(--bg))' : 'var(--surface)',
                  cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  color: code === c.code ? 'var(--accent)' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                <img src={c.flag} alt={c.code} style={{ width: 18, height: 18, borderRadius: 3, objectFit: 'cover' }} />
                {c.label}
              </button>
            ))}
          </div>

          {/* Number input */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--surface)', border: `1.5px solid ${error ? '#ef4444' : 'var(--border)'}`,
            borderRadius: 12, padding: '0 14px',
            transition: 'border-color 0.15s',
          }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>+{code}</span>
            <div style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />
            <input
              type="tel"
              placeholder="712 345 678"
              value={phone}
              onChange={e => { setPhone(e.target.value); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              autoFocus
              style={{
                flex: 1, border: 'none', background: 'transparent',
                padding: '13px 0', fontSize: 15, color: 'var(--text)',
                outline: 'none', fontFamily: 'var(--font)',
              }}
            />
          </div>
          {error && (
            <p style={{ fontSize: 12, color: '#ef4444', margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              <i className="ri-error-warning-line" /> {error}
            </p>
          )}
        </div>

        {/* Button */}
        <button
          onClick={save}
          disabled={saving || !phone.trim()}
          style={{
            padding: '13px', borderRadius: 12, border: 'none',
            background: phone.trim() ? 'var(--accent)' : 'var(--border)',
            color: phone.trim() ? '#fff' : 'var(--text-muted)',
            fontWeight: 700, fontSize: 14, cursor: phone.trim() ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s, color 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {saving
            ? <><i className="ri-loader-4-line" /> Saving…</>
            : <><i className="ri-check-line" /> Save & Continue</>
          }
        </button>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
          Your number is private and only used by Nabogaming staff.
        </p>
      </div>
    </div>
  )
}
