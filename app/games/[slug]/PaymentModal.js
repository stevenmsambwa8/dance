'use client'
import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import styles from './modals.module.css'

function fmtFee(n) { return Number(n).toLocaleString() }

export default function PaymentModal({ tournament, user, onClose, onSubmitted }) {
  const [payRef,  setPayRef]  = useState('')
  const [payPhone,setPayPhone]= useState('')
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')
  const [copied,  setCopied]  = useState(null)

  function copyNum(which, num) {
    navigator.clipboard?.writeText(num).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = num; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    })
    setCopied(which); setTimeout(() => setCopied(null), 2000)
  }

  async function submit() {
    if (!payRef.trim() && !payPhone.trim()) { setErr('Enter your transaction ID or phone number'); return }
    setLoading(true); setErr('')
    const { data: existing } = await supabase.from('tournament_payments').select('id, status')
      .eq('tournament_id', tournament.id).eq('user_id', user.id).maybeSingle()
    if (existing?.status === 'approved')          { setErr('Already approved — refresh.'); setLoading(false); return }
    if (existing?.status === 'payment_submitted') { setErr('Already submitted — awaiting admin.'); setLoading(false); return }
    const { error } = await supabase.from('tournament_payments').upsert({
      tournament_id: tournament.id, user_id: user.id,
      payment_ref: payRef.trim() || null, payment_phone: payPhone.trim() || null,
      amount: tournament.entrance_fee, status: 'payment_submitted',
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'tournament_id,user_id' })
    if (error) { setErr(error.message); setLoading(false); return }
    const { data: admins } = await supabase.from('profiles').select('id')
      .in('email', ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com'])
    if (admins?.length) {
      const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).single()
      await supabase.from('notifications').insert(admins.map(a => ({
        user_id: a.id, title: '💳 Tournament Payment — Verify',
        body: `${prof?.username || 'A player'} paid TZS ${fmtFee(tournament.entrance_fee)} for "${tournament.name}". Ref: ${payRef.trim() || payPhone.trim()}`,
        type: 'payment', meta: { tournament_id: tournament.id, action: 'verify_tournament_payment' }, read: false,
      })))
    }
    await supabase.from('notifications').insert({
      user_id: user.id, title: '⏳ Payment Submitted',
      body: `Entry fee for "${tournament.name}" is pending admin approval.`,
      type: 'tournament', meta: { tournament_id: tournament.id }, read: false,
    })
    onSubmitted(tournament.id)
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}><i className="ri-close-line" /></button>
        <div className={styles.payHeader}>
          <i className="ri-secure-payment-line" />
          <div>
            <h3 className={styles.payTitle}>Send Entry Fee</h3>
            <p className={styles.paySub}>Choose one account, send <strong>TZS {fmtFee(tournament.entrance_fee)}</strong>, then submit proof.</p>
          </div>
        </div>
        <div className={styles.payAmountPill}>
          <span>Amount to send</span>
          <strong>TZS {fmtFee(tournament.entrance_fee)}</strong>
        </div>
        <p className={styles.payChooseLabel}><span>Choose one account</span></p>
        <div className={styles.payGrid}>
          <div className={styles.payCard}>
            <div className={styles.payCardHead}><i className="ri-sim-card-line" style={{ color: '#e11d48' }} /><span>Halopesa</span></div>
            <div className={styles.payCardNum}>
              <span>25165945</span>
              <button className={`${styles.copyBtn} ${copied === 'halo' ? styles.copyBtnDone : ''}`} onClick={() => copyNum('halo', '25165945')}>
                {copied === 'halo' ? <><i className="ri-check-line" /> Copied</> : <><i className="ri-file-copy-line" /> Copy</>}
              </button>
            </div>
            <div className={styles.payCardMeta}><span>Lipa Number</span><span className={styles.payCardAcct}>NABOGAMING</span></div>
          </div>
          <div className={styles.payCard}>
            <div className={styles.payCardHead}><i className="ri-sim-card-2-line" style={{ color: '#16a34a' }} /><span>M-Pesa</span></div>
            <div className={styles.payCardNum}>
              <span>36835506</span>
              <button className={`${styles.copyBtn} ${copied === 'mpesa' ? styles.copyBtnDone : ''}`} onClick={() => copyNum('mpesa', '36835506')}>
                {copied === 'mpesa' ? <><i className="ri-check-line" /> Copied</> : <><i className="ri-file-copy-line" /> Copy</>}
              </button>
            </div>
            <div className={styles.payCardMeta}><span>Lipa Number</span><span className={styles.payCardAcct}>STEVEN DAVID</span></div>
          </div>
        </div>
        <p className={styles.payProofLabel}>After paying, paste your proof below:</p>
        <div className={styles.modalField}>
          <label><i className="ri-fingerprint-line" /> Transaction ID / Reference <span className={styles.req}>*</span></label>
          <input type="text" placeholder="e.g. ABC12345XY" value={payRef} onChange={e => setPayRef(e.target.value)} />
        </div>
        <div className={styles.modalField}>
          <label><i className="ri-phone-line" /> Phone Number Used</label>
          <input type="tel" placeholder="e.g. 0712 345 678" value={payPhone} onChange={e => setPayPhone(e.target.value)} />
        </div>
        {err && <p className={styles.modalErr}><i className="ri-error-warning-line" /> {err}</p>}
        <button className={styles.modalSubmit} onClick={submit} disabled={loading || (!payRef.trim() && !payPhone.trim())}>
          {loading ? <><i className="ri-loader-4-line" /> Submitting…</> : <><i className="ri-check-double-line" /> I've Paid — Notify Admin</>}
        </button>
      </div>
    </div>
  )
}
