'use client'
/**
 * components/UpgradeModal.js
 * Opens when a locked feature is tapped.
 * Shows plan cards → payment details → submission confirmation.
 */
import { useState, useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import { PLANS, PLAN_PRICES, FEATURE_PLAN, getPlanPrice, getPlanPriceTZS, getActivePlan } from '../lib/plans'

const PAYMENT_DETAILS = {
  mpesa:    { label: 'M-Pesa',   number: '36835506', name: 'STEVEN DAVID', icon: 'ri-smartphone-line' },
  halopesa: { label: 'Halopesa', number: '25165945', name: 'NABOGAMING',   icon: 'ri-smartphone-line' },
}

const ORDER = ['free', 'pro', 'elite', 'team']

export default function UpgradeModal({ feature, profile, onClose }) {
  const { user } = useAuth()
  const countryFlag = profile?.country_flag || 'tanzania'
  const currentPlan = getActivePlan(profile)
  const currentIdx  = ORDER.indexOf(currentPlan)

  const requiredKey = FEATURE_PLAN[feature] || 'pro'
  const [selected,   setSelected]   = useState(requiredKey)
  const [step,       setStep]       = useState('plans')
  const [method,     setMethod]     = useState('mpesa')
  const [phone,      setPhone]      = useState('')
  const [ref,        setRef]        = useState('')
  const [copied,     setCopied]     = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function copyNumber(key, number) {
    navigator.clipboard.writeText(number).catch(() => {})
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!user) return
    if (!phone.trim()) { setError('Enter your payment phone number'); return }
    setError(''); setSubmitting(true)
    try {
      const { error: err } = await supabase.from('subscriptions').insert({
        user_id:        user.id,
        plan:           selected,
        amount_tzs:     getPlanPriceTZS(selected),
        currency:       PLAN_PRICES[countryFlag]?.currency || 'TZS',
        payment_method: method,
        payment_phone:  phone.trim(),
        payment_ref:    ref.trim() || null,
        status:         'pending',
      })
      if (err) throw err
      setStep('done')
    } catch (err) {
      setError(err.message || 'Submission failed. Try again.')
    } finally { setSubmitting(false) }
  }

  const selectedPlan = PLANS[selected]
  const price        = getPlanPrice(selected, countryFlag)
  const payment      = PAYMENT_DETAILS[method]
  const upgradeablePlans = Object.values(PLANS).filter(p => p.key !== 'free' && ORDER.indexOf(p.key) > currentIdx)

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 9997, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'umFadeIn 0.18s ease' }}>
      <style>{`
        @keyframes umFadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes umSlideUp { from{opacity:0;transform:translateY(20px) scale(0.97)} to{opacity:1;transform:none} }
        .um-input { width:100%; border:1px solid var(--border-dark); background:var(--bg-2); color:var(--text); border-radius:6px; padding:10px 12px; font-size:13px; font-family:var(--font); outline:none; box-sizing:border-box; }
        .um-input:focus { border-color:var(--text); }
        .um-copy-btn { display:flex; align-items:center; gap:5px; padding:6px 10px; border:1px solid var(--border-dark); background:var(--bg-2); color:var(--text-muted); border-radius:5px; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap; font-family:var(--font); transition:all 0.15s; }
        .um-copy-btn:hover { background:var(--surface); color:var(--text); }
        .um-method-btn:hover { background:var(--surface) !important; }
      `}</style>

      <div style={{ background: 'var(--bg)', border: '1px solid var(--border-dark)', borderRadius: 16, width: '100%', maxWidth: 420, maxHeight: 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'umSlideUp 0.22s cubic-bezier(0.22,1,0.36,1)', position: 'relative' }}>

        {/* Close */}
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, zIndex: 1, width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
          <i className="ri-close-line" />
        </button>

        {/* ── PLANS ── */}
        {step === 'plans' && (
          <div style={{ overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 14, scrollbarWidth: 'none' }}>
            <div style={{ textAlign: 'center', paddingRight: 30 }}>
              <p style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', margin: '0 0 4px' }}>Upgrade Your Plan</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Unlock more power on Nabogaming</p>
            </div>

            {upgradeablePlans.map(plan => {
              const isSelected = selected === plan.key
              const px = getPlanPrice(plan.key, countryFlag)
              return (
                <button key={plan.key} onClick={() => setSelected(plan.key)} style={{ border: isSelected ? `2px solid ${plan.color}` : '2px solid var(--border)', borderRadius: 12, padding: '14px', background: isSelected ? plan.color + '10' : 'var(--bg-2)', cursor: 'pointer', textAlign: 'left', position: 'relative', transition: 'all 0.15s', width: '100%' }}>
                  {plan.popular && <span style={{ position: 'absolute', top: -1, right: 12, background: plan.color, color: '#fff', fontSize: 9, fontWeight: 800, padding: '3px 7px', borderRadius: '0 0 6px 6px', letterSpacing: '0.06em' }}>MOST POPULAR</span>}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{plan.badge}</span>
                      <div>
                        <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: 0, lineHeight: 1.1 }}>{plan.label}</p>
                        <p style={{ fontSize: 11, color: plan.color, fontWeight: 700, margin: '2px 0 0' }}>{px} / month</p>
                      </div>
                    </div>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${isSelected ? plan.color : 'var(--border-dark)'}`, background: isSelected ? plan.color : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {isSelected && <i className="ri-check-line" style={{ fontSize: 11, color: '#fff' }} />}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {plan.features.slice(0, 4).map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                        <i className="ri-check-line" style={{ color: plan.color, fontSize: 13, flexShrink: 0, marginTop: 1 }} /><span>{f}</span>
                      </div>
                    ))}
                    {plan.features.length > 4 && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0 19px' }}>+{plan.features.length - 4} more</p>}
                  </div>
                </button>
              )
            })}

            <button onClick={() => setStep('payment')} style={{ padding: 13, background: selectedPlan.color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'var(--font)' }}>
              Continue with {selectedPlan.label} <i className="ri-arrow-right-line" />
            </button>
          </div>
        )}

        {/* ── PAYMENT ── */}
        {step === 'payment' && (
          <div style={{ overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 14, scrollbarWidth: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 30 }}>
              <button onClick={() => setStep('plans')} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border-dark)', background: 'var(--bg-2)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                <i className="ri-arrow-left-line" />
              </button>
              <div>
                <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', margin: 0 }}>{selectedPlan.badge} {selectedPlan.label} Plan</p>
                <p style={{ fontSize: 12, color: selectedPlan.color, fontWeight: 700, margin: 0 }}>{price} / month</p>
              </div>
            </div>

            {/* Method toggle */}
            <div>
              <Label>Payment Method</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {Object.entries(PAYMENT_DETAILS).map(([key, det]) => (
                  <button key={key} className="um-method-btn" onClick={() => setMethod(key)} style={{ padding: '10px 12px', border: `1.5px solid ${method === key ? 'var(--text)' : 'var(--border)'}`, borderRadius: 8, background: method === key ? 'var(--surface)' : 'var(--bg-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.15s' }}>
                    <i className={det.icon} style={{ fontSize: 16, color: method === key ? 'var(--text)' : 'var(--text-muted)' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: method === key ? 'var(--text)' : 'var(--text-muted)', fontFamily: 'var(--font)' }}>{det.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Send to */}
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Send {price} to</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <p style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', margin: 0, letterSpacing: 1 }}>{payment.number}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{payment.name} · {payment.label}</p>
                </div>
                <button className="um-copy-btn" onClick={() => copyNumber(method, payment.number)}>
                  {copied === method ? <><i className="ri-check-line" style={{ color: '#22c55e' }} /> Copied</> : <><i className="ri-file-copy-line" /> Copy</>}
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <Label>Your Payment Phone Number *</Label>
                <input className="um-input" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div>
                <Label>Transaction Reference <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(optional)</span></Label>
                <input className="um-input" placeholder="e.g. MPESA123ABC" value={ref} onChange={e => setRef(e.target.value)} />
              </div>
              {error && <p style={{ fontSize: 12, color: '#ef4444', margin: 0 }}>{error}</p>}
              <button type="submit" disabled={submitting} style={{ marginTop: 4, padding: 13, background: selectedPlan.color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1, fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {submitting ? 'Submitting…' : <><i className="ri-send-plane-line" /> Submit Payment Proof</>}
              </button>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                Admin verifies your payment within 24 hours then activates your plan.
              </p>
            </form>
          </div>
        )}

        {/* ── DONE ── */}
        {step === 'done' && (
          <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: selectedPlan.color + '20', border: `2px solid ${selectedPlan.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
              {selectedPlan.badge}
            </div>
            <div>
              <p style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', margin: '0 0 6px' }}>Payment Submitted!</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                Your <strong style={{ color: selectedPlan.color }}>{selectedPlan.label}</strong> upgrade is under review. You'll be notified once activated — usually within 24 hours.
              </p>
            </div>
            <button onClick={onClose} style={{ padding: '11px 28px', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Label({ children }) {
  return <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', margin: '0 0 6px', letterSpacing: '0.04em' }}>{children}</p>
}
