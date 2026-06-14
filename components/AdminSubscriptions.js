'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { PLANS } from '../lib/plans'

const STATUS_COLORS = {
  pending:   { color: '#f59e0b', bg: '#f59e0b18', label: 'Pending'   },
  active:    { color: '#22c55e', bg: '#22c55e18', label: 'Active'    },
  rejected:  { color: '#ef4444', bg: '#ef444418', label: 'Rejected'  },
  expired:   { color: '#8e8e93', bg: '#8e8e9318', label: 'Expired'   },
  cancelled: { color: '#8e8e93', bg: '#8e8e9318', label: 'Cancelled' },
}

const FILTERS = ['all', 'pending', 'active', 'rejected', 'expired', 'cancelled']

export default function AdminSubscriptions({ onCountChange }) {
  const [subs,    setSubs]    = useState([])
  const [filter,  setFilter]  = useState('pending')
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(null)
  const [notes,   setNotes]   = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('subscriptions')
      .select('*, profiles(username, avatar_url, country_flag, plan)')
      .order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('status', filter)
    const { data, error } = await q
    if (error) console.error('AdminSubscriptions load error:', error)
    setSubs(data || [])
    setLoading(false)
    if (onCountChange) {
      const { count } = await supabase
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      onCountChange(count || 0)
    }
  }, [filter, onCountChange])

  useEffect(() => { load() }, [load])

  async function activate(sub) {
    setActing(sub.id)
    try {
      await supabase.rpc('activate_subscription', { p_subscription_id: sub.id, p_months: 1 })
      await supabase.from('notifications').insert({
        user_id: sub.user_id,
        title:   `${PLANS[sub.plan]?.label} Plan Activated! ${PLANS[sub.plan]?.badge}`,
        body:    `Your ${PLANS[sub.plan]?.label} subscription is now active. Enjoy your new features!`,
        type:    'system',
        meta:    { plan: sub.plan },
        read:    false,
      })
      load()
    } finally { setActing(null) }
  }

  async function reject(sub) {
    setActing(sub.id)
    try {
      await supabase.rpc('reject_subscription', {
        p_subscription_id: sub.id,
        p_notes: notes[sub.id] || null,
      })
      await supabase.from('notifications').insert({
        user_id: sub.user_id,
        title:   'Subscription Payment Not Verified',
        body:    `We couldn't verify your ${PLANS[sub.plan]?.label} payment. Please resubmit with the correct reference or contact support.`,
        type:    'system',
        meta:    { plan: sub.plan },
        read:    false,
      })
      load()
    } finally { setActing(null) }
  }

  async function cancel(sub) {
    if (!window.confirm(`Cancel ${sub.profiles?.username || 'this user'}'s ${PLANS[sub.plan]?.label} plan? This will reset them to free immediately.`)) return
    setActing(sub.id)
    try {
      await supabase.rpc('cancel_subscription', {
        p_subscription_id: sub.id,
        p_notes: notes[sub.id] || 'Cancelled by admin',
      })
      await supabase.from('notifications').insert({
        user_id: sub.user_id,
        title:   'Subscription Cancelled',
        body:    `Your ${PLANS[sub.plan]?.label} plan has been cancelled by admin. Contact support if you think this is a mistake.`,
        type:    'system',
        meta:    { plan: sub.plan },
        read:    false,
      })
      load()
    } finally { setActing(null) }
  }

  const pendingCount = subs.filter(s => s.status === 'pending').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: 0 }}>Subscriptions</p>
          {pendingCount > 0 && filter !== 'pending' && (
            <span style={{ background: '#f59e0b', color: '#000', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10 }}>
              {pendingCount} pending
            </span>
          )}
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid var(--border-dark)', borderRadius: 7, background: 'var(--bg-2)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
          <i className="ri-refresh-line" /> Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', background: filter === f ? 'var(--text)' : 'var(--bg-2)', color: filter === f ? 'var(--bg)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)', textTransform: 'capitalize', transition: 'all 0.15s' }}>
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : subs.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No {filter === 'all' ? '' : filter} subscriptions</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {subs.map(sub => {
            const plan     = PLANS[sub.plan] || {}
            const status   = STATUS_COLORS[sub.status] || STATUS_COLORS.pending
            const profile  = sub.profiles || {}
            const isActing = acting === sub.id

            return (
              <div key={sub.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 14px', background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0, overflow: 'hidden' }}>
                      {profile.avatar_url
                        ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : (profile.username?.[0]?.toUpperCase() || '?')}
                    </div>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', margin: 0 }}>{profile.username || 'Unknown'}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Current plan: {profile.plan || 'free'}</p>
                    </div>
                  </div>
                  <span style={{ padding: '4px 9px', borderRadius: 6, background: status.bg, color: status.color, fontSize: 11, fontWeight: 700, border: `1px solid ${status.color}33` }}>
                    {status.label}
                  </span>
                </div>

                {/* Plan + payment info */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    ['Plan',    `${plan.badge || ''} ${plan.label || sub.plan}`],
                    ['Amount',  `${sub.currency} ${Number(sub.amount_tzs).toLocaleString()}`],
                    ['Method',  sub.payment_method?.toUpperCase() || '—'],
                    ['Phone',   sub.payment_phone || '—'],
                    ['Ref',     sub.payment_ref   || '—'],
                    ['Date',    new Date(sub.created_at).toLocaleDateString('en-TZ', { day:'numeric', month:'short', year:'numeric' })],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* Expiry for active */}
                {sub.status === 'active' && sub.expires_at && (
                  <p style={{ fontSize: 11, color: '#22c55e', margin: 0 }}>
                    <i className="ri-calendar-check-line" /> Expires: {new Date(sub.expires_at).toLocaleDateString('en-TZ', { day:'numeric', month:'long', year:'numeric' })}
                  </p>
                )}

                {sub.notes && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>Note: {sub.notes}</p>
                )}

                {/* Actions — pending */}
                {sub.status === 'pending' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => activate(sub)} disabled={isActing}
                        style={{ flex: 1, padding: '10px 0', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isActing ? 'not-allowed' : 'pointer', opacity: isActing ? 0.6 : 1, fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <i className="ri-check-line" /> {isActing ? 'Processing…' : 'Activate'}
                      </button>
                      <button onClick={() => reject(sub)} disabled={isActing}
                        style={{ flex: 1, padding: '10px 0', background: '#ef444418', color: '#ef4444', border: '1px solid #ef444433', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isActing ? 'not-allowed' : 'pointer', opacity: isActing ? 0.6 : 1, fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <i className="ri-close-line" /> Reject
                      </button>
                    </div>
                    <input
                      placeholder="Rejection note (optional)"
                      value={notes[sub.id] || ''}
                      onChange={e => setNotes(n => ({ ...n, [sub.id]: e.target.value }))}
                      style={{ padding: '8px 10px', border: '1px solid var(--border-dark)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font)', outline: 'none' }}
                    />
                  </div>
                )}

                {/* Actions — active: cancel */}
                {sub.status === 'active' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button onClick={() => cancel(sub)} disabled={isActing}
                      style={{ width: '100%', padding: '10px 0', background: '#ef444418', color: '#ef4444', border: '1px solid #ef444433', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isActing ? 'not-allowed' : 'pointer', opacity: isActing ? 0.6 : 1, fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <i className="ri-forbid-line" /> {isActing ? 'Cancelling…' : 'Cancel Subscription'}
                    </button>
                    <input
                      placeholder="Cancellation reason (optional)"
                      value={notes[sub.id] || ''}
                      onChange={e => setNotes(n => ({ ...n, [sub.id]: e.target.value }))}
                      style={{ padding: '8px 10px', border: '1px solid var(--border-dark)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font)', outline: 'none' }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
