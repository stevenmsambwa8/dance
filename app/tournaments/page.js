'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'
import { getCurrentSeason } from '../../lib/seasons'

const GAME_NAMES = Object.fromEntries(GAME_SLUGS.map(s => [s, GAME_META[s].name]))

function fmtFee(n) { return Number(n).toLocaleString() }

// ── Skeleton ──────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonTop}>
        <div className={styles.skeletonBadge} />
        <div className={styles.skeletonBadge} style={{ width: 60 }} />
      </div>
      <div className={styles.skeletonTitle} />
      <div className={styles.skeletonDesc} />
      <div className={styles.skeletonStats}>
        <div className={styles.skeletonStat} />
        <div className={styles.skeletonStat} />
        <div className={styles.skeletonStat} />
      </div>
    </div>
  )
}

// ── Payment Modal ─────────────────────────────────────────────────────────────
function PaymentModal({ tournament, user, onClose, onSubmitted }) {
  const [payRef,    setPayRef]    = useState('')
  const [payPhone,  setPayPhone]  = useState('')
  const [loading,   setLoading]   = useState(false)
  const [err,       setErr]       = useState('')
  const [copied,    setCopied]    = useState(null) // 'halo' | 'mpesa'

  function copyNumber(which, num) {
    navigator.clipboard?.writeText(num).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = num; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    })
    setCopied(which)
    setTimeout(() => setCopied(null), 2000)
  }

  async function submit() {
    if (!payRef.trim() && !payPhone.trim()) { setErr('Enter your transaction ID or phone number'); return }
    setLoading(true); setErr('')

    const { data: existing } = await supabase
      .from('tournament_payments').select('id, status')
      .eq('tournament_id', tournament.id).eq('user_id', user.id).maybeSingle()

    if (existing?.status === 'approved')          { setErr('Already approved — refresh.'); setLoading(false); return }
    if (existing?.status === 'payment_submitted') { setErr('Already submitted — awaiting admin.'); setLoading(false); return }

    const { error } = await supabase.from('tournament_payments').upsert({
      tournament_id: tournament.id, user_id: user.id,
      payment_ref:   payRef.trim() || null,
      payment_phone: payPhone.trim() || null,
      amount:        tournament.entrance_fee,
      status:        'payment_submitted',
      submitted_at:  new Date().toISOString(),
    }, { onConflict: 'tournament_id,user_id' })

    if (error) { setErr(error.message); setLoading(false); return }

    const { data: admins } = await supabase.from('profiles').select('id')
      .in('email', ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com'])
    if (admins?.length) {
      const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).single()
      await supabase.from('notifications').insert(admins.map(a => ({
        user_id: a.id,
        title:   '💳 Tournament Payment — Verify',
        body:    `${prof?.username || 'A player'} paid TZS ${fmtFee(tournament.entrance_fee)} for "${tournament.name}". Ref: ${payRef.trim() || payPhone.trim()}`,
        type: 'payment', meta: { tournament_id: tournament.id, action: 'verify_tournament_payment' }, read: false,
      })))
    }
    await supabase.from('notifications').insert({
      user_id: user.id, title: '⏳ Payment Submitted',
      body:    `Entry fee for "${tournament.name}" is pending admin approval.`,
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

        {/* Amount pill */}
        <div className={styles.payAmountPill}>
          <span>Amount to send</span>
          <strong>TZS {fmtFee(tournament.entrance_fee)}</strong>
        </div>

        {/* OR — choose one */}
        <p className={styles.payChooseLabel}><span>Choose one account</span></p>

        {/* Grid of two accounts */}
        <div className={styles.payGrid}>
          {/* Halopesa */}
          <div className={styles.payCard}>
            <div className={styles.payCardHead}>
              <i className="ri-sim-card-line" style={{ color: '#e11d48' }} />
              <span>Halopesa</span>
            </div>
            <div className={styles.payCardNum}>
              <span>25165945</span>
              <button
                className={`${styles.copyBtn} ${copied === 'halo' ? styles.copyBtnDone : ''}`}
                onClick={() => copyNumber('halo', '25165945')}
              >
                {copied === 'halo' ? <><i className="ri-check-line" /> Copied</> : <><i className="ri-file-copy-line" /> Copy</>}
              </button>
            </div>
            <div className={styles.payCardMeta}>
              <span>Lipa Number</span>
              <span className={styles.payCardAcct}>NABOGAMING</span>
            </div>
          </div>

          {/* M-Pesa */}
          <div className={styles.payCard}>
            <div className={styles.payCardHead}>
              <i className="ri-sim-card-2-line" style={{ color: '#16a34a' }} />
              <span>M-Pesa</span>
            </div>
            <div className={styles.payCardNum}>
              <span>36835506</span>
              <button
                className={`${styles.copyBtn} ${copied === 'mpesa' ? styles.copyBtnDone : ''}`}
                onClick={() => copyNumber('mpesa', '36835506')}
              >
                {copied === 'mpesa' ? <><i className="ri-check-line" /> Copied</> : <><i className="ri-file-copy-line" /> Copy</>}
              </button>
            </div>
            <div className={styles.payCardMeta}>
              <span>Lipa Number</span>
              <span className={styles.payCardAcct}>STEVEN DAVID</span>
            </div>
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

        <button
          className={styles.modalSubmit}
          onClick={submit}
          disabled={loading || (!payRef.trim() && !payPhone.trim())}
        >
          {loading
            ? <><i className="ri-loader-4-line" /> Submitting…</>
            : <><i className="ri-check-double-line" /> I've Paid — Notify Admin</>}
        </button>
      </div>
    </div>
  )
}


// ── Payment Status Modal (pending / rejected) ─────────────────────────────────
function PaymentStatusModal({ status, onClose }) {
  const isPending = status === 'payment_submitted'
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}><i className="ri-close-line" /></button>
        <i className={`${isPending ? 'ri-time-line' : 'ri-close-circle-line'} ${styles.modalIcon}`}
           style={{ color: isPending ? '#f59e0b' : '#ef4444' }} />
        <h3 className={styles.modalTitle}>{isPending ? 'Payment Under Review' : 'Payment Rejected'}</h3>
        <p className={styles.modalSub}>
          {isPending
            ? 'Your payment proof has been submitted. Admin will verify and approve your registration shortly.'
            : 'Your payment was rejected. Please double-check your reference number and resubmit, or contact support.'}
        </p>
        <button className={styles.modalSubmit} onClick={onClose}>Got it</button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Tournaments() {
  const { user, isAdmin } = useAuth()
  const router = useRouter()

  const [tournaments, setTournaments] = useState([])
  const [loading,     setLoading]     = useState(true)
  usePageLoading(loading)

  const [filter,      setFilter]      = useState('all')
  const [registered,  setRegistered]  = useState({})  // tournament_id → true
  const [paymentMap,  setPaymentMap]  = useState({})  // tournament_id → payment status

  // Modal state
  const [payModal,    setPayModal]    = useState(null) // tournament object
  const [statusModal, setStatusModal] = useState(null) // { status }

  useEffect(() => { loadTournaments() }, [filter])

  // Live slot-count updates
  useEffect(() => {
    const ch = supabase
      .channel('tourney-list-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, () => {
        loadTournaments()
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  // Registration map
  useEffect(() => {
    if (!user || tournaments.length === 0) return
    supabase.from('tournament_participants').select('tournament_id').eq('user_id', user.id)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(r => { map[r.tournament_id] = true })
        setRegistered(map)
      })
  }, [user, tournaments.length])

  // Payment status map (only for paid tournaments)
  useEffect(() => {
    if (!user || tournaments.length === 0) return
    const paidIds = tournaments.filter(t => (t.entrance_fee || 0) > 0).map(t => t.id)
    if (!paidIds.length) return
    supabase.from('tournament_payments')
      .select('tournament_id, status')
      .eq('user_id', user.id)
      .in('tournament_id', paidIds)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(r => { map[r.tournament_id] = r.status })
        setPaymentMap(map)
      })
  }, [user, tournaments.length])

  async function loadTournaments() {
    setLoading(true)
    let q = supabase.from('tournaments').select('*').order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('game_slug', filter)
    const { data } = await q
    const all = data || []
    // Hide test tournaments from non-creator / non-admin
    const visible = all.filter(t => {
      if (!t.is_test) return true
      if (!user)      return false
      return isAdmin || t.created_by === user.id
    })
    setTournaments(visible)
    setLoading(false)
  }

  function fillPct(t) {
    return Math.min(100, Math.round(((t.registered_count || 0) / (t.slots || 1)) * 100))
  }

  function handleRegisterClick(e, t) {
    e.stopPropagation()
    if (!user) { router.push('/login'); return }
    const hasFee = (t.entrance_fee || 0) > 0
    if (!hasFee) {
      // Free — go straight to detail page where register() fires
      router.push(`/tournaments/${t.slug || t.id}`)
      return
    }
    const pmtStatus = paymentMap[t.id]
    if (pmtStatus === 'payment_submitted') { setStatusModal({ status: 'payment_submitted' }); return }
    if (pmtStatus === 'rejected')          { setStatusModal({ status: 'rejected' }); return }
    // No payment yet — open modal
    setPayModal(t)
  }

  function onPaymentSubmitted(tournamentId) {
    setPayModal(null)
    setPaymentMap(m => ({ ...m, [tournamentId]: 'payment_submitted' }))
  }

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Season {getCurrentSeason()}</p>
          <h1 className={styles.headline}>TOURNAMENTS</h1>
        </div>
        {user && (
          <button className={styles.createBtn} onClick={() => router.push('/tournaments/create')}
            title="Create Tournament" aria-label="Create Tournament">
            <i className="ri-add-line" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        {['all', ...GAME_SLUGS].map(f => (
          <button key={f}
            className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
            onClick={() => setFilter(f)}
          >{f === 'all' ? 'All Games' : GAME_NAMES[f] || f}</button>
        ))}
      </div>

      {/* Skeleton */}
      {loading && (
        <div className={styles.list}>
          {[1,2,3].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && tournaments.length === 0 && (
        <div className={styles.empty}>
          <i className="ri-tournament-line" />
          <p>No tournaments found</p>
          <span>Check back later or try a different filter</span>
        </div>
      )}

      {/* List */}
      {!loading && tournaments.length > 0 && (
        <div className={styles.list}>
          {tournaments.map(t => {
            const pct       = fillPct(t)
            const isFull    = (t.registered_count || 0) >= t.slots
            const isReg     = registered[t.id]
            const hasFee    = (t.entrance_fee || 0) > 0
            const pmtStatus = paymentMap[t.id]
            const isPending = pmtStatus === 'payment_submitted'

            return (
              <div key={t.id} className={styles.card}
                onClick={() => router.push(`/tournaments/${t.slug || t.id}`)}>

                {/* Top row */}
                <div className={styles.cardTop}>
                  <div className={styles.cardMeta}>
                    <Link href={`/games/${t.game_slug}`} className={styles.gameTag}
                      onClick={e => e.stopPropagation()}>
                      {GAME_NAMES[t.game_slug] || t.game_slug}
                    </Link>
                    <span className={`${styles.statusBadge} ${styles[t.status]}`}>{t.status}</span>

                    {/* Test badge */}
                    {t.is_test && (
                      <span className={styles.testBadge}><i className="ri-flask-line" /> Test</span>
                    )}
                    {/* Entry fee badge */}
                    {hasFee && (
                      <span className={styles.feeBadge}>
                        <i className="ri-money-dollar-circle-line" /> TZS {fmtFee(t.entrance_fee)}
                      </span>
                    )}
                    {/* Registration / payment status */}
                    {isReg && (
                      <span className={styles.regBadge}>
                        <i className="ri-checkbox-circle-fill" /> Registered
                      </span>
                    )}
                    {isPending && !isReg && (
                      <span className={styles.pendingBadge}>
                        <i className="ri-time-line" /> Pending
                      </span>
                    )}
                    {isFull && !isReg && (
                      <span className={styles.fullBadge}><i className="ri-lock-line" /> Full</span>
                    )}
                  </div>
                  <h3 className={styles.cardName}>{t.name}</h3>
                  {t.description && <p className={styles.cardDesc}>{t.description}</p>}
                </div>

                {/* Stats row */}
                <div className={styles.cardStats}>
                  {t.format && <span><i className="ri-gamepad-line" />{t.format}</span>}
                  <span><i className="ri-trophy-line" />TZS {t.prize || 'N/A'}</span>
                  {t.date && <span><i className="ri-calendar-event-line" />{t.date}</span>}
                </div>

                {/* Slot bar */}
                <div className={styles.slotBar}>
                  <div className={styles.slotBarLabels}>
                    <span className={styles.slotBarLeft}>
                      <i className="ri-group-line" /> {t.registered_count || 0} / {t.slots} players
                    </span>
                    <span className={`${styles.slotBarPct} ${pct >= 80 ? styles.slotHot : ''}`}>
                      {pct}%{pct >= 80 && <> <i className="ri-fire-line" /></>}
                    </span>
                  </div>
                  <div className={styles.slotTrack}>
                    <div
                      className={`${styles.slotFill} ${isFull ? styles.slotFull : pct >= 80 ? styles.slotWarm : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Footer CTA */}
                <div className={styles.cardFooter}>
                  {isReg ? (
                    <span className={styles.regBadge} style={{ fontSize: 12 }}>
                      <i className="ri-checkbox-circle-fill" /> You&apos;re registered
                    </span>
                  ) : isPending ? (
                    <span className={styles.pendingBadge} style={{ fontSize: 12 }}>
                      <i className="ri-time-line" /> Payment awaiting approval
                    </span>
                  ) : isFull ? (
                    <span className={styles.fullBadge} style={{ fontSize: 12 }}>
                      <i className="ri-lock-line" /> Tournament full
                    </span>
                  ) : t.status !== 'active' ? (
                    <span className={styles.viewLink}>
                      View bracket &amp; details <i className="ri-arrow-right-line" />
                    </span>
                  ) : (
                    <button className={styles.registerBtn} onClick={e => handleRegisterClick(e, t)}>
                      {hasFee
                        ? <><i className="ri-money-dollar-circle-line" /> Register · TZS {fmtFee(t.entrance_fee)}</>
                        : <><i className="ri-add-circle-line" /> Register Free</>}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {payModal && (
        <PaymentModal
          tournament={payModal}
          user={user}
          onClose={() => setPayModal(null)}
          onSubmitted={onPaymentSubmitted}
        />
      )}
      {statusModal && (
        <PaymentStatusModal
          status={statusModal.status}
          onClose={() => setStatusModal(null)}
        />
      )}

    </div>
  )
}
