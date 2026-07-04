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

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS  = 90000

export default function UpgradeModal({ feature, profile, onClose }) {
  const { user } = useAuth()
  const countryFlag = profile?.country_flag || 'tanzania'
  const currentPlan = getActivePlan(profile)
  const currentIdx  = ORDER.indexOf(currentPlan)

  // SonicPesa USSD push currently only supports TZS — other currencies fall back to manual proof
  const ussdAvailable = countryFlag === 'tanzania'

  const requiredKey = FEATURE_PLAN[feature] || 'pro'
  const [selected,     setSelected]     = useState(requiredKey)
  const [step,         setStep]         = useState('plans') // plans | payment | pushing | done | manual
  const [method,       setMethod]       = useState('mpesa')
  const [phone,        setPhone]        = useState('')
  const [ref,          setRef]          = useState('')
  const [copied,       setCopied]       = useState(null)
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState('')
  const [subscriptionId, setSubscriptionId] = useState(null)
  const [pushStatus,   setPushStatus]   = useState('') // waiting | timeout | failed

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function copyNumber(key, number) {
    navigator.clipboard.writeText(number).catch(() => {})
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }

  // ── SonicPesa USSD push flow ──────────────────────────────
  async function handlePushPay(e) {
    e.preventDefault()
    if (!user) return
    if (!phone.trim()) { setError('Enter your M-Pesa phone number'); return }
    setError(''); setSubmitting(true)

    try {
      const { data: sub, error: subErr } = await supabase.from('subscriptions').insert({
        user_id:        user.id,
        plan:           selected,
        amount_tzs:     getPlanPriceTZS(selected),
        currency:       'TZS',
        payment_method: 'sonicpesa',
        payment_phone:  phone.trim(),
        status:         'pending',
      }).select().single()
      if (subErr) throw subErr
      setSubscriptionId(sub.id)

      const res = await fetch('/api/sonicpesa/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan:  selected,
          phone: phone.trim(),
          name:  profile?.username || '',
          email: profile?.email || user?.email || '',
        }),
      })
      const json = await res.json()
      if (!json.ok || !json.order_id) throw new Error(json.error || 'Could not start payment')

      await supabase.from('subscriptions').update({ payment_ref: json.order_id }).eq('id', sub.id)

      setStep('pushing')
      setPushStatus('waiting')
      pollStatus(json.order_id, sub.id, Date.now())
    } catch (err) {
      setError(err.message || 'Could not start payment. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function pollStatus(orderId, subId, startedAt) {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      setPushStatus('timeout')
      return
    }
    try {
      const res = await fetch('/api/sonicpesa/order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      })
      const json = await res.json()

      if (json.ok && json.status === 'success') {
        await activatePaidSubscription(subId)
        return
      }
      if (json.ok && json.status === 'failed') {
        setPushStatus('failed')
        return
      }
      setTimeout(() => pollStatus(orderId, subId, startedAt), POLL_INTERVAL_MS)
    } catch {
      setTimeout(() => pollStatus(orderId, subId, startedAt), POLL_INTERVAL_MS)
    }
  }

  async function activatePaidSubscription(subId) {
    try {
      const { error: rpcErr } = await supabase.rpc('activate_subscription', {
        p_subscription_id: subId,
        p_months: 1,
      })
      if (rpcErr) throw rpcErr
      setStep('done')
    } catch (err) {
      setError('Payment received, but activation needs a moment. Support will confirm shortly.')
      setStep('done')
    }
  }

  function retryPush() {
    setPushStatus('')
    setStep('payment')
  }

  // ── Manual proof-of-payment flow (fallback for non-TZS) ──
  async function handleManualSubmit(e) {
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

            <button onClick={() => setStep(ussdAvailable ? 'payment' : 'manual')} style={{ padding: 13, background: selectedPlan.color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'var(--font)' }}>
              Continue with {selectedPlan.label} <i className="ri-arrow-right-line" />
            </button>
          </div>
        )}

        {/* ── PAYMENT (SonicPesa USSD push) ── */}
        {step === 'payment' && ussdAvailable && (
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

            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', textAlign: 'center' }}>
              <i className="ri-smartphone-line" style={{ fontSize: 26, color: selectedPlan.color }} />
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>You'll get a USSD payment prompt</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Enter your M-Pesa PIN on your phone to confirm {price}.</p>
            </div>

            <form onSubmit={handlePushPay} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <Label>Your M-Pesa Phone Number *</Label>
                <input className="um-input" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              {error && <p style={{ fontSize: 12, color: '#ef4444', margin: 0 }}>{error}</p>}
              <button type="submit" disabled={submitting} style={{ marginTop: 4, padding: 13, background: selectedPlan.color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1, fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {submitting ? 'Sending push…' : <><i className="ri-send-plane-line" /> Pay {price} Now</>}
              </button>
              <button type="button" onClick={() => setStep('manual')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                Pay manually instead
              </button>
            </form>
          </div>
        )}

        {/* ── PUSHING (waiting for USSD confirmation) ── */}
        {step === 'pushing' && (
          <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
            {pushStatus === 'waiting' && (
              <>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: selectedPlan.color + '20', border: `2px solid ${selectedPlan.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
                  <i className="ri-smartphone-line" style={{ color: selectedPlan.color }} />
                </div>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', margin: '0 0 6px' }}>Check your phone</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                    A USSD prompt was sent to <strong style={{ color: 'var(--text)' }}>{phone}</strong>. Enter your PIN to complete the {price} payment.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: selectedPlan.color, opacity: 0.4, animation: `umPulse 1.2s ${i * 0.2}s infinite ease-in-out` }} />
                  ))}
                </div>
                <style>{`@keyframes umPulse { 0%,100%{opacity:.3} 50%{opacity:1} }`}</style>
              </>
            )}

            {pushStatus === 'timeout' && (
              <>
                <i className="ri-time-line" style={{ fontSize: 40, color: '#f59e0b' }} />
                <div>
                  <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', margin: '0 0 6px' }}>Still waiting…</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                    We haven't received confirmation yet. If you already entered your PIN, it may just need a bit more time — check again shortly, or try again.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <button onClick={retryPush} style={{ flex: 1, padding: 12, background: selectedPlan.color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>Try Again</button>
                  <button onClick={onClose} style={{ flex: 1, padding: 12, background: 'var(--bg-2)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>Close</button>
                </div>
              </>
            )}

            {pushStatus === 'failed' && (
              <>
                <i className="ri-close-circle-line" style={{ fontSize: 40, color: '#ef4444' }} />
                <div>
                  <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', margin: '0 0 6px' }}>Payment didn't go through</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                    The payment was declined or cancelled. You can try again.
                  </p>
                </div>
                <button onClick={retryPush} style={{ width: '100%', padding: 12, background: selectedPlan.color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>Try Again</button>
              </>
            )}
          </div>
        )}

        {/* ── MANUAL FALLBACK (non-TZS or opted out of USSD push) ── */}
        {step === 'manual' && (
          <div style={{ overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 14, scrollbarWidth: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 30 }}>
              <button onClick={() => setStep(ussdAvailable ? 'payment' : 'plans')} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border-dark)', background: 'var(--bg-2)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                <i className="ri-arrow-left-line" />
              </button>
              <div>
                <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', margin: 0 }}>{selectedPlan.badge} {selectedPlan.label} Plan</p>
                <p style={{ fontSize: 12, color: selectedPlan.color, fontWeight: 700, margin: 0 }}>{price} / month</p>
              </div>
            </div>

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

            <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              <p style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', margin: '0 0 6px' }}>
                {error ? 'Payment Received!' : 'Plan Activated!'}
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                {error
                  ? error
                  : <>Your <strong style={{ color: selectedPlan.color }}>{selectedPlan.label}</strong> plan is now active. Enjoy your new features!</>}
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
