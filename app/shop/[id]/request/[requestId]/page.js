'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth, ADMIN_EMAIL } from '../../../../../components/AuthProvider'
import { supabase } from '../../../../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../../../../components/usePageLoading'

/* ── helpers ── */
function fmtPrice(val) {
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? '—' : n.toLocaleString()
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60)    return s + 's ago'
  if (s < 3600)  return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const STEP_MAP = {
  pending: 0, accepted: 1,
  payment_submitted: 2, admin_approved: 3,
  payout_pending: 3, completed: 4,
}
const STATUS_COLOR = {
  pending: '#f59e0b', accepted: '#22c55e', declined: '#ef4444',
  completed: '#22c55e', payment_submitted: '#0ea5e9',
  admin_approved: '#a855f7', payout_pending: '#f97316', expired: '#ef4444',
}
const STATUS_LABEL = {
  pending: 'Pending', accepted: 'Accepted', declined: 'Declined',
  completed: 'Completed', payment_submitted: 'Payment Sent',
  admin_approved: 'Admin Approved', payout_pending: 'Payout Pending', expired: 'Expired',
}
const STEPS = ['Request', 'Accepted', 'Payment', 'Approved', 'Done']
const DEADLINE_MS = 10 * 3600 * 1000

function useCountdown(paidAt, active) {
  const [rem, setRem] = useState(null)
  useEffect(() => {
    if (!paidAt || !active) { setRem(null); return }
    const deadline = new Date(paidAt).getTime() + DEADLINE_MS
    const tick = () => setRem(Math.max(0, deadline - Date.now()))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [paidAt, active])
  return rem
}

function fmtCd(ms) {
  if (ms === null) return null
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

/* ── Modal overlay ── */
function Modal({ onClose, children }) {
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}>
          <i className="ri-close-line" />
        </button>
        {children}
      </div>
    </div>
  )
}

export default function RequestDetailPage() {
  const { id, requestId } = useParams()
  const { user, isAdmin } = useAuth()
  const router = useRouter()

  const [request,   setRequest]   = useState(null)
  const [item,      setItem]      = useState(null)
  const [messages,  setMessages]  = useState([])
  const [myProfile, setMyProfile] = useState(null)
  const [loading,   setLoading]   = useState(true)
  usePageLoading(loading)

  const [msgText,  setMsgText]  = useState('')
  const [sending,  setSending]  = useState(false)

  /* buyer payment form */
  const [payRef,   setPayRef]   = useState('')
  const [payPhone, setPayPhone] = useState('')
  const [payLoad,  setPayLoad]  = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)

  /* seller payout form */
  const [poName,   setPoName]   = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [poMsg,    setPoMsg]    = useState('')
  const [poLoad,   setPoLoad]   = useState(false)
  const [showPoModal, setShowPoModal] = useState(false)

  const [adminLoad, setAdminLoad] = useState(false)
  const [callSent,  setCallSent]  = useState(false)
  const [callLoad,  setCallLoad]  = useState(false)

  const bottomRef = useRef(null)

  const isSeller = item && user && user.id === item.seller_id
  const isBuyer  = request && user && user.id === request.buyer_id
  const step     = request ? (STEP_MAP[request.status] ?? 0) : 0

  const timerActive = ['payment_submitted','admin_approved','payout_pending'].includes(request?.status)
  const countdown   = useCountdown(request?.paid_at, timerActive)
  const timerUrgent = countdown !== null && countdown < 2 * 3600 * 1000

  /* ── load ── */
  const loadAll = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [{ data: req }, { data: prof }] = await Promise.all([
      supabase.from('buy_requests')
        .select('*, buyer:profiles!buy_requests_buyer_id_fkey(id,username,tier,level,avatar_url), seller:profiles!buy_requests_seller_id_fkey(id,username,tier,level,avatar_url)')
        .eq('id', requestId).single(),
      supabase.from('profiles').select('username').eq('id', user.id).single(),
    ])
    if (!req) { router.push('/shop/' + id); return }
    setRequest(req)
    setMyProfile(prof || null)
    const { data: it } = await supabase.from('shop_items')
      .select('id,seller_id,title,price,category,active').eq('id', req.item_id).single()
    setItem(it || null)
    const { data: msgs } = await supabase.from('negotiation_messages')
      .select('*,profiles(username,avatar_url)').eq('request_id', requestId)
      .order('created_at', { ascending: true })
    setMessages(msgs || [])
    setLoading(false)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 150)
  }, [user, requestId, id, router])

  useEffect(() => { loadAll() }, [loadAll])

  /* Auto-open payment modal when buyer lands on accepted status */
  useEffect(() => {
    if (request?.status === 'accepted' && isBuyer) setShowPayModal(true)
  }, [request?.status, isBuyer])

  /* Auto-open payout modal when seller lands on admin_approved status */
  useEffect(() => {
    if (request?.status === 'admin_approved' && isSeller) setShowPoModal(true)
  }, [request?.status, isSeller])

  /* realtime */
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('req-' + requestId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'negotiation_messages', filter: 'request_id=eq.' + requestId }, p => {
        supabase.from('negotiation_messages').select('*,profiles(username,avatar_url)').eq('id', p.new.id).single()
          .then(({ data }) => {
            if (data) {
              setMessages(prev => prev.find(m => m.id === data.id) ? prev : [...prev, data])
              setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
            }
          })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'buy_requests', filter: 'id=eq.' + requestId }, p => {
        setRequest(prev => prev ? { ...prev, ...p.new } : prev)
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [user, requestId])

  /* expiry watcher */
  useEffect(() => {
    if (countdown !== 0 || !timerActive || !request || request.status === 'expired') return
    ;(async () => {
      await supabase.from('buy_requests').update({ status: 'expired', closed_reason: '10-hour window expired' }).eq('id', requestId)
      await Promise.all([
        supabase.rpc('penalise_user', { uid: request.buyer_id,  amount: 100 }),
        supabase.rpc('penalise_user', { uid: request.seller_id, amount: 100 }),
      ])
      const body = `The 10-hour window for "${item?.title}" expired. −100 pts applied. Funds refunded.`
      await supabase.from('notifications').insert([
        { user_id: request.buyer_id,  type: 'request_update', title: '⏰ Negotiation Expired', body, meta: { request_id: requestId, item_id: id }, read: false },
        { user_id: request.seller_id, type: 'request_update', title: '⏰ Negotiation Expired', body, meta: { request_id: requestId, item_id: id }, read: false },
      ])
    })()
  }, [countdown, timerActive])

  /* ── helpers ── */
  async function getAdminId() {
    const { data } = await supabase.from('profiles').select('id').eq('email', ADMIN_EMAIL).single()
    return data?.id || null
  }

  async function notifyAdmin(title, body) {
    const adminId = await getAdminId()
    if (!adminId) return
    await supabase.from('notifications').insert({
      user_id: adminId, type: 'request_update', title, body,
      meta: { request_id: requestId, item_id: id, todo: true }, read: false,
    })
  }

  /* ── send message ── */
  async function sendMessage() {
    if (!msgText.trim() || !request) return
    setSending(true)
    const { data: msg } = await supabase.from('negotiation_messages')
      .insert({ request_id: requestId, sender_id: user.id, body: msgText.trim() })
      .select('*,profiles(username,avatar_url)').single()
    if (msg) {
      const other = isSeller ? request.buyer_id : request.seller_id
      await supabase.from('notifications').insert({
        user_id: other, type: 'negotiation_message', title: 'New message',
        body: (myProfile?.username || 'Someone') + ': ' + msgText.trim().slice(0, 80),
        meta: { request_id: requestId, item_id: id }, read: false,
      })
      setMessages(p => [...p, msg])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
    setMsgText('')
    setSending(false)
  }

  /* ── seller accept/decline ── */
  async function updateStatus(status) {
    await supabase.from('buy_requests').update({ status }).eq('id', requestId)
    await supabase.from('notifications').insert({
      user_id: request.buyer_id, type: 'request_update',
      title: status === 'accepted' ? '✅ Offer Accepted!' : '❌ Offer Declined',
      body: status === 'accepted'
        ? `Your offer on "${item?.title}" was accepted. Proceed to payment.`
        : `Your offer on "${item?.title}" was declined.`,
      meta: { request_id: requestId, item_id: id }, read: false,
    })
    setRequest(r => ({ ...r, status }))
  }

  /* ── buyer: I've Paid ── */
  async function submitPayment() {
    if (!payRef.trim() && !payPhone.trim()) return
    setPayLoad(true)
    const now = new Date().toISOString()
    await supabase.from('buy_requests').update({
      status: 'payment_submitted',
      payment_ref: payRef.trim() || null,
      payment_phone: payPhone.trim() || null,
      paid_at: now,
    }).eq('id', requestId)
    const buyerName = myProfile?.username || 'Buyer'
    await notifyAdmin(
      `💳 Payment Submitted — Approve Now`,
      `${buyerName} paid for "${item?.title}". Ref: ${payRef || payPhone}. Go to Admin → Todos.`
    )
    await supabase.from('notifications').insert({
      user_id: request.seller_id, type: 'request_update',
      title: '💳 Buyer has paid!',
      body: `${buyerName} submitted payment for "${item?.title}". Awaiting admin approval.`,
      meta: { request_id: requestId, item_id: id }, read: false,
    })
    // ── update local state immediately ──
    setRequest(r => ({ ...r, status: 'payment_submitted', payment_ref: payRef.trim() || null, payment_phone: payPhone.trim() || null, paid_at: now }))
    setPayLoad(false)
    setShowPayModal(false)
  }

  /* ── admin approve ── */
  async function adminApprove() {
    setAdminLoad(true)
    const now = new Date().toISOString()
    await supabase.from('buy_requests').update({
      status: 'admin_approved',
      admin_approved_at: now,
    }).eq('id', requestId)
    await supabase.from('notifications').insert([
      {
        user_id: request.seller_id, type: 'request_update',
        title: '✅ Payment Confirmed — Fill Payout Details',
        body: `Payment for "${item?.title}" verified. Please fill in your account name & number for payout.`,
        meta: { request_id: requestId, item_id: id }, read: false,
      },
      {
        user_id: request.buyer_id, type: 'request_update',
        title: '✅ Payment Verified by Admin',
        body: `Your payment for "${item?.title}" is confirmed. Waiting for seller's delivery details.`,
        meta: { request_id: requestId, item_id: id }, read: false,
      },
    ])
    // ── update local state immediately ──
    setRequest(r => ({ ...r, status: 'admin_approved', admin_approved_at: now }))
    setAdminLoad(false)
  }

  /* ── seller: fill payout ── */
  async function submitPayout() {
    if (!poName.trim() || !poNumber.trim()) return
    setPoLoad(true)
    const now = new Date().toISOString()
    await supabase.from('buy_requests').update({
      status: 'payout_pending',
      payout_name: poName.trim(),
      payout_number: poNumber.trim(),
      seller_message: poMsg.trim() || null,
      payout_filled_at: now,
    }).eq('id', requestId)
    await notifyAdmin(
      `🏦 Payout Details Ready — Release Funds`,
      `Seller filled payout for "${item?.title}". Account: ${poName.trim()} — ${poNumber.trim()}.`
    )
    await supabase.from('notifications').insert({
      user_id: request.buyer_id, type: 'request_update',
      title: '📦 Seller provided details',
      body: `The seller submitted their info for "${item?.title}". Admin is processing final release.`,
      meta: { request_id: requestId, item_id: id }, read: false,
    })
    // ── update local state immediately ──
    setRequest(r => ({ ...r, status: 'payout_pending', payout_name: poName.trim(), payout_number: poNumber.trim(), seller_message: poMsg.trim() || null }))
    setPoLoad(false)
    setShowPoModal(false)
  }

  /* ── admin complete ── */
  async function adminComplete() {
    setAdminLoad(true)
    await supabase.from('buy_requests').update({ status: 'completed' }).eq('id', requestId)
    if (item?.id) await supabase.from('shop_items').update({ active: false }).eq('id', item.id)

    // ── log payout in seller's wallet ──
    await supabase.rpc('log_earning', {
      p_user_id: request.seller_id,
      p_type: 'shop_payout',
      p_points: 0,
      p_description: `Shop sale — "${item?.title}" · Payout to ${request.payout_name} (${request.payout_number}) · TZS ${fmtPrice(request.offer_price)}`,
      p_ref_id: requestId,
    })

    await supabase.from('notifications').insert([
      {
        user_id: request.buyer_id, type: 'request_update',
        title: '🎉 Transaction Complete!',
        body: `Your purchase of "${item?.title}" is complete.`,
        meta: { request_id: requestId, item_id: id }, read: false,
      },
      {
        user_id: request.seller_id, type: 'request_update',
        title: '💰 Payout Released!',
        body: `Funds for "${item?.title}" released to ${request.payout_name} — ${request.payout_number}.`,
        meta: { request_id: requestId, item_id: id }, read: false,
      },
    ])
    // ── update local state immediately ──
    setRequest(r => ({ ...r, status: 'completed' }))
    setAdminLoad(false)
  }

  /* ── request a call ── */
  async function requestCall() {
    setCallLoad(true)
    const name = myProfile?.username || user.email
    const role = isBuyer ? 'Buyer' : isSeller ? 'Seller' : 'Admin'
    await notifyAdmin(
      `📞 Call Requested by ${role}`,
      `${name} (${role}) requests a call about "${item?.title}" — Status: ${STATUS_LABEL[request.status]}.`
    )
    const other = isBuyer ? request.seller_id : isSeller ? request.buyer_id : null
    if (other) {
      await supabase.from('notifications').insert({
        user_id: other, type: 'request_update',
        title: `📞 ${name} requested a call with admin`,
        body: `Regarding "${item?.title}". Admin will reach out soon.`,
        meta: { request_id: requestId, item_id: id }, read: false,
      })
    }
    setCallLoad(false)
    setCallSent(true)
    setTimeout(() => setCallSent(false), 6000)
  }

  /* ── render guards ── */
  if (!user) return (
    <div className={styles.page}>
      <div className={styles.centered}>
        <i className="ri-lock-line" style={{ fontSize: 32, color: 'var(--text-muted)' }} />
        <p>Log in to view this request.</p>
        <Link href="/login" className={styles.primaryBtn}>Log In</Link>
      </div>
    </div>
  )
  if (loading) return null
  if (!request) return (
    <div className={styles.page}>
      <div className={styles.centered}>
        <p>Request not found.</p>
        <Link href={'/shop/' + id} className={styles.backLink}>Back to item</Link>
      </div>
    </div>
  )

  const buyer     = request.buyer
  const seller    = request.seller
  const isExpired = request.status === 'expired'
  const isClosed  = isExpired || request.status === 'declined' || request.status === 'completed'
  const sc        = STATUS_COLOR[request.status] || '#888'

  return (
    <div className={styles.page}>

      {/* ══════════════ FIXED HEADER ══════════════ */}
      <div className={styles.stickyHeader}>

        {/* nav row: back + title + call */}
        <div className={styles.navBar}>
          <button className={styles.back} onClick={() => router.push('/shop/' + id)}>
            <i className="ri-arrow-left-line" />
          </button>

          {/* avatars + item info — centre */}
          <div className={styles.headerOffer}>
            <div className={styles.miniAvatar}>
              {buyer?.avatar_url
                ? <img src={buyer.avatar_url} alt="" />
                : <span>{buyer?.username?.[0]?.toUpperCase() || '?'}</span>}
            </div>
            <i className={`ri-arrow-right-line ${styles.headerArrow}`} />
            <div className={styles.miniAvatar}>
              {seller?.avatar_url
                ? <img src={seller.avatar_url} alt="" />
                : <span>{seller?.username?.[0]?.toUpperCase() || '?'}</span>}
            </div>
            <div className={styles.headerInfo}>
              <span className={styles.headerTitle}>{item?.title || '—'}</span>
              <span className={styles.headerAmt}>TZS {fmtPrice(request.offer_price)}</span>
            </div>
          </div>

          {/* status pill */}
          <span className={styles.statusPill} style={{ color: sc, borderColor: sc + '40', background: sc + '16' }}>
            <span className={styles.statusDot} style={{ background: sc }} />
            {STATUS_LABEL[request.status] || request.status}
          </span>
        </div>

        {/* step progress bar (compact, inline) */}
        {!isExpired && request.status !== 'declined' && (
          <div className={styles.stepRow}>
            {STEPS.map((label, i) => {
              const done    = step > i
              const current = step === i
              return (
                <div key={label} className={styles.stepItem}>
                  <div className={`${styles.stepDot} ${done ? styles.stepDone : current ? styles.stepCurrent : ''}`}>
                    {done ? <i className="ri-check-line" /> : i + 1}
                  </div>
                  <span className={`${styles.stepLabel} ${(done || current) ? styles.stepLabelActive : ''}`}>{label}</span>
                  {i < STEPS.length - 1 && <div className={`${styles.stepLine} ${done ? styles.stepLineDone : ''}`} />}
                </div>
              )
            })}
          </div>
        )}

        {/* countdown timer (only when active) */}
        {timerActive && countdown !== null && (
          <div className={`${styles.timerBar} ${timerUrgent ? styles.timerBarUrgent : ''}`}>
            <i className={timerUrgent ? 'ri-alarm-warning-line' : 'ri-timer-line'} />
            <span>Payment window: </span>
            <span className={styles.timerCount}>{fmtCd(countdown)}</span>
            <span className={styles.timerLabel}> remaining</span>
          </div>
        )}

        {/* ── ACTION STRIP (pinned, never hidden) ── */}
        <div className={styles.actionStrip}>

          {/* banners */}
          {isExpired && (
            <div className={styles.stripBanner} style={{ borderColor: '#ef444440', background: '#ef444410', color: '#ef4444' }}>
              <i className="ri-time-line" />
              <span><strong>Expired</strong> — 10-hour window passed. −100 pts applied, funds refunded.</span>
            </div>
          )}
          {request.status === 'declined' && (
            <div className={styles.stripBanner} style={{ borderColor: '#ef444440', background: '#ef444410', color: '#ef4444' }}>
              <i className="ri-close-circle-line" />
              <span>Offer declined.</span>
              {isBuyer && <Link href={'/shop/' + id} className={styles.tryAgainLink}>Send new request →</Link>}
            </div>
          )}
          {request.status === 'completed' && (
            <div className={styles.stripBanner} style={{ borderColor: '#22c55e40', background: '#22c55e10', color: '#22c55e' }}>
              <i className="ri-trophy-fill" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>Transaction Complete 🎉</strong>
                {isBuyer && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>Your purchase is confirmed. Check the seller's note below.</span>}
                {isSeller && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>Funds released to {request.payout_name} — {request.payout_number}.</span>}
                {request.seller_message && (
                  <div className={styles.deliveryMsg} style={{ marginTop: 6 }}>
                    <span className={styles.deliveryLabel}><i className="ri-file-text-line" /> Seller's delivery info:</span>
                    <p>{request.seller_message}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PENDING */}
          {request.status === 'pending' && isSeller && (
            <div className={styles.stripAction}>
              <div className={styles.stripActionLeft}>
                <span className={styles.stripActionTitle}><i className="ri-inbox-2-line" /> New Offer</span>
                {request.note && <span className={styles.stripNote}>"{request.note}"</span>}
              </div>
              <div className={styles.stripBtns}>
                <button className={styles.acceptBtn} onClick={() => updateStatus('accepted')}><i className="ri-check-line" /> Accept</button>
                <button className={styles.declineBtn} onClick={() => updateStatus('declined')}><i className="ri-close-line" /></button>
              </div>
            </div>
          )}
          {request.status === 'pending' && isBuyer && (
            <div className={styles.stripInfo}>
              <i className="ri-time-line" style={{ color: '#f59e0b' }} />
              <span>Waiting for seller to respond…</span>
              {!isClosed && (
                <button className={`${styles.callBtn} ${callSent ? styles.callBtnSent : ''}`} onClick={requestCall} disabled={callLoad || callSent}>
                  {callSent ? <><i className="ri-checkbox-circle-line" /> Sent!</> : <><i className="ri-phone-line" /> Call</>}
                </button>
              )}
            </div>
          )}

          {/* ACCEPTED — buyer */}
          {request.status === 'accepted' && isBuyer && (
            <div className={styles.stripAction}>
              <div className={styles.stripActionLeft}>
                <span className={styles.stripActionTitle} style={{ color: '#22c55e' }}><i className="ri-secure-payment-line" /> Send Payment</span>
                <span className={styles.stripNote}>
                  Pay <strong style={{ color: '#22c55e' }}>TZS {fmtPrice(request.offer_price)}</strong> to <strong>00000000</strong> (Nabogaming)
                </span>
              </div>
              <button className={styles.paidBtn} style={{ flexShrink: 0 }} onClick={() => setShowPayModal(true)}>
                <i className="ri-check-double-line" /> I've Paid
              </button>
            </div>
          )}
          {request.status === 'accepted' && isSeller && (
            <div className={styles.stripInfo}>
              <i className="ri-checkbox-circle-fill" style={{ color: '#22c55e' }} />
              <span>Offer accepted — waiting for buyer to send payment.</span>
            </div>
          )}

          {/* PAYMENT SUBMITTED */}
          {request.status === 'payment_submitted' && isBuyer && (
            <div className={styles.stripInfo}>
              <i className="ri-loader-4-line" style={{ color: '#0ea5e9' }} />
              <span>Payment submitted — admin is verifying.</span>
            </div>
          )}
          {request.status === 'payment_submitted' && isSeller && (
            <div className={styles.stripInfo}>
              <i className="ri-bank-card-line" style={{ color: '#0ea5e9' }} />
              <span>Buyer submitted payment — awaiting admin approval.</span>
            </div>
          )}
          {request.status === 'payment_submitted' && isAdmin && (
            <div className={styles.stripAction}>
              <div className={styles.stripActionLeft}>
                <span className={styles.stripActionTitle} style={{ color: '#f59e0b' }}><i className="ri-shield-check-line" /> Verify Payment</span>
                <span className={styles.stripNote}>
                  {buyer?.username} → {seller?.username} · TZS {fmtPrice(request.offer_price)}
                  {request.payment_ref && <> · Ref: {request.payment_ref}</>}
                  {request.payment_phone && <> · {request.payment_phone}</>}
                </span>
              </div>
              <button className={styles.adminApproveBtn} style={{ flexShrink: 0 }} onClick={adminApprove} disabled={adminLoad}>
                {adminLoad ? '…' : <><i className="ri-check-double-line" /> Approve</>}
              </button>
            </div>
          )}

          {/* ADMIN APPROVED */}
          {request.status === 'admin_approved' && isSeller && (
            <div className={styles.stripAction}>
              <div className={styles.stripActionLeft}>
                <span className={styles.stripActionTitle} style={{ color: '#a855f7' }}><i className="ri-bank-line" /> Fill Payout Details</span>
                <span className={styles.stripNote}>Payment confirmed! Enter your account to receive funds.</span>
              </div>
              <button className={styles.paidBtn} style={{ background: '#a855f7', flexShrink: 0 }} onClick={() => setShowPoModal(true)}>
                <i className="ri-send-plane-line" /> Fill
              </button>
            </div>
          )}
          {request.status === 'admin_approved' && isBuyer && (
            <div className={styles.stripInfo}>
              <i className="ri-checkbox-circle-fill" style={{ color: '#22c55e' }} />
              <span>Payment verified — waiting for seller's delivery details.</span>
            </div>
          )}
          {request.status === 'admin_approved' && isAdmin && (
            <div className={styles.stripInfo}>
              <i className="ri-loader-4-line" style={{ color: '#a855f7' }} />
              <span>Waiting for seller to fill payout details.</span>
            </div>
          )}

          {/* PAYOUT PENDING */}
          {request.status === 'payout_pending' && isAdmin && (
            <div className={styles.stripAction}>
              <div className={styles.stripActionLeft}>
                <span className={styles.stripActionTitle} style={{ color: '#f97316' }}><i className="ri-money-dollar-circle-line" /> Release Payout</span>
                <span className={styles.stripNote}>
                  {request.payout_name} · {request.payout_number} · TZS {fmtPrice(request.offer_price)}
                </span>
              </div>
              <button className={styles.adminCompleteBtn} style={{ flexShrink: 0 }} onClick={adminComplete} disabled={adminLoad}>
                {adminLoad ? '…' : <><i className="ri-check-double-line" /> Release</>}
              </button>
            </div>
          )}
          {request.status === 'payout_pending' && (isBuyer || isSeller) && (
            <div className={styles.stripInfo}>
              <i className="ri-loader-4-line" style={{ color: '#f97316' }} />
              <span>{isSeller ? `Payout to ${request.payout_name} (${request.payout_number}) — almost done!` : 'Admin is processing final payout. Almost done!'}</span>
            </div>
          )}

          {/* call button for non-pending states */}
          {!isClosed && request.status !== 'pending' && (
            <button
              className={`${styles.callBtnSmall} ${callSent ? styles.callBtnSent : ''}`}
              onClick={requestCall}
              disabled={callLoad || callSent}
            >
              {callSent ? <><i className="ri-checkbox-circle-line" /> Requested!</> : callLoad ? '…' : <><i className="ri-phone-line" /> Request Call</>}
            </button>
          )}

        </div>{/* /actionStrip */}
      </div>{/* /stickyHeader */}

      {/* ══════════════ CHAT — fills remaining space ══════════════ */}
      <div className={styles.chatArea}>
        {messages.length === 0 && (
          <div className={styles.chatEmpty}>
            <i className="ri-chat-3-line" />
            <p>No messages yet.</p>
          </div>
        )}
        {messages.map((msg, idx) => {
          const mine = msg.sender_id === user?.id
          const other = isSeller ? buyer : seller
          const showAuthor = idx === 0 || messages[idx - 1].sender_id !== msg.sender_id
          return (
            <div key={msg.id} className={`${styles.msgGroup} ${mine ? styles.msgGroupMine : styles.msgGroupTheirs}`}>
              {!mine && showAuthor && (
                <div className={styles.msgAuthorRow}>
                  <div className={styles.msgAvatar}>
                    {other?.avatar_url ? <img src={other.avatar_url} alt="" /> : <span>{msg.profiles?.username?.[0]?.toUpperCase() || '?'}</span>}
                  </div>
                  <span className={styles.msgAuthor}>{msg.profiles?.username || '?'}</span>
                </div>
              )}
              <div className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleTheirs}`}>{msg.body}</div>
              <span className={styles.msgTime}>{timeAgo(msg.created_at)}</span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* ══════════════ FIXED SEND BAR ══════════════ */}
      <div className={styles.sendBar}>
        {!isClosed ? (
          <>
            <input
              className={styles.input}
              placeholder="Type a message…"
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              disabled={sending}
            />
            <button className={styles.sendBtn} onClick={sendMessage} disabled={sending || !msgText.trim()}>
              <i className="ri-arrow-up-line" />
            </button>
          </>
        ) : (
          <div className={styles.closedNotice}><i className="ri-lock-line" /> This negotiation is closed.</div>
        )}
      </div>

      {/* ══════════════ PAYMENT MODAL (buyer) ══════════════ */}
      {showPayModal && (
        <Modal onClose={() => setShowPayModal(false)}>
          <p className={styles.modalTitle}><i className="ri-secure-payment-line" style={{ color: '#22c55e' }} /> Send Payment</p>
          <p className={styles.modalSub}>Send the exact amount to the account below, then submit your proof.</p>
          <div className={styles.paymentBox} style={{ marginBottom: 14 }}>
            <div className={styles.payRow} style={{ paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <i className="ri-sim-card-line" style={{ color: '#e11d48' }} /> Halopesa — Lipa Number
              </span>
            </div>
            <div className={styles.payRow}><span>Lipa Number</span><strong style={{ fontSize: 18, letterSpacing: 1 }}>25165945</strong></div>
            <div className={styles.payRow}><span>Account Name</span><strong>NABOGAMING</strong></div>

            <div className={styles.payRow} style={{ paddingTop: 10, marginTop: 8, paddingBottom: 8, marginBottom: 4, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <i className="ri-sim-card-2-line" style={{ color: '#16a34a' }} /> M-Pesa — Lipa Number
              </span>
            </div>
            <div className={styles.payRow}><span>Lipa Number</span><strong style={{ fontSize: 18, letterSpacing: 1 }}>36835506</strong></div>
            <div className={styles.payRow}><span>Account Name</span><strong>STEVEN DAVID</strong></div>

            <div className={styles.payRow} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <span>Amount</span><strong style={{ color: '#22c55e' }}>TZS {fmtPrice(request.offer_price)}</strong>
            </div>
            <div className={styles.payRow}><span>Reference</span><strong>{item?.title?.slice(0, 25)}</strong></div>
          </div>
          <p className={styles.modalSub} style={{ fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>After paying, enter your proof below:</p>
          <div className={styles.payForm}>
            <div className={styles.payField}>
              <label><i className="ri-fingerprint-line" /> Transaction ID / Reference</label>
              <input placeholder="e.g. ABC12345XY" value={payRef} onChange={e => setPayRef(e.target.value)} />
            </div>
            <div className={styles.payField}>
              <label><i className="ri-phone-line" /> Phone Number Used</label>
              <input placeholder="e.g. 0712345678" value={payPhone} onChange={e => setPayPhone(e.target.value)} />
            </div>
          </div>
          <button
            className={styles.paidBtn}
            onClick={submitPayment}
            disabled={payLoad || (!payRef.trim() && !payPhone.trim())}
          >
            {payLoad ? 'Submitting…' : <><i className="ri-check-double-line" /> I've Paid — Notify Admin</>}
          </button>
          <p className={styles.warningNote}><i className="ri-alarm-warning-line" /> 10-hour window starts on submission. Timeout = −100 pts & refund for both parties.</p>
        </Modal>
      )}

      {/* ══════════════ PAYOUT MODAL (seller) ══════════════ */}
      {showPoModal && (
        <Modal onClose={() => setShowPoModal(false)}>
          <p className={styles.modalTitle}><i className="ri-bank-line" style={{ color: '#a855f7' }} /> Fill Payout Details</p>
          <p className={styles.modalSub}>Payment confirmed! Enter your account details to receive payment.</p>
          <div className={styles.payForm}>
            <div className={styles.payField}>
              <label><i className="ri-user-line" /> Full Name (Account Holder)</label>
              <input placeholder="Your M-Pesa / bank name" value={poName} onChange={e => setPoName(e.target.value)} />
            </div>
            <div className={styles.payField}>
              <label><i className="ri-phone-line" /> Account / Phone Number</label>
              <input placeholder="e.g. 0712345678" value={poNumber} onChange={e => setPoNumber(e.target.value)} />
            </div>
            <div className={styles.payField}>
              <label><i className="ri-file-text-line" /> Message / Delivery Info for Buyer <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
              <textarea rows={3} placeholder="Account credentials, tracking number, instructions…" value={poMsg} onChange={e => setPoMsg(e.target.value)} />
            </div>
          </div>
          <button
            className={styles.paidBtn} style={{ background: '#a855f7' }}
            onClick={submitPayout}
            disabled={poLoad || !poName.trim() || !poNumber.trim()}
          >
            {poLoad ? 'Submitting…' : <><i className="ri-send-plane-line" /> Submit Details & Notify Admin</>}
          </button>
        </Modal>
      )}

    </div>
  )
}
