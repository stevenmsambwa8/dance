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

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

function fmtFee(n) {
  return Number(n).toLocaleString()
}

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

/* ── Payment Modal ── */
function PaymentModal({ tournament, onClose, onSubmitted }) {
  const [payRef, setPayRef]     = useState('')
  const [payPhone, setPayPhone] = useState('')
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const { user } = useAuth()

  async function submit() {
    if (!payRef.trim() || !payPhone.trim()) { setErr('Fill in all fields'); return }
    setLoading(true)
    setErr('')
    // Check for existing pending payment
    const { data: existing } = await supabase
      .from('tournament_payments')
      .select('id, status')
      .eq('tournament_id', tournament.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      if (existing.status === 'approved') {
        setErr('Your payment is already approved. Refresh the page.')
        setLoading(false); return
      }
      if (existing.status === 'payment_submitted') {
        setErr('You already submitted a payment — waiting for admin approval.')
        setLoading(false); return
      }
    }

    const { error } = await supabase.from('tournament_payments').upsert({
      tournament_id: tournament.id,
      user_id: user.id,
      payment_ref: payRef.trim(),
      payment_phone: payPhone.trim(),
      amount: tournament.entrance_fee,
      status: 'payment_submitted',
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'tournament_id,user_id' })

    if (error) { setErr(error.message); setLoading(false); return }

    // Notify admin
    const { data: admins } = await supabase
      .from('profiles')
      .select('id')
      .in('email', ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com'])

    if (admins?.length) {
      const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).single()
      await supabase.from('notifications').insert(
        admins.map(a => ({
          user_id: a.id,
          title: '💳 Tournament Payment — Verify',
          body: `${prof?.username || 'A player'} submitted TZS ${fmtFee(tournament.entrance_fee)} entry fee for "${tournament.name}". Ref: ${payRef.trim()}`,
          type: 'payment',
          meta: { tournament_id: tournament.id, action: 'verify_tournament_payment' },
          read: false,
        }))
      )
    }

    // Notify user
    await supabase.from('notifications').insert({
      user_id: user.id,
      title: '⏳ Payment Submitted',
      body: `Your entry fee for "${tournament.name}" is pending admin approval. Ref: ${payRef.trim()}`,
      type: 'tournament',
      meta: { tournament_id: tournament.id },
      read: false,
    })

    onSubmitted()
  }

return (
  <div className={styles.modalBackdrop} onClick={onClose}>
    <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
      <button className={styles.modalClose} onClick={onClose}>
        <i className="ri-close-line" />
      </button>

      <div className={styles.modalIcon}>
        <i className="ri-money-dollar-circle-line" />
      </div>

      <h3 className={styles.modalTitle}>Entry Fee Required</h3>

      <p className={styles.modalSub}>
        Send <strong>TZS {fmtFee(tournament.entrance_fee)}</strong> using one of the options below, then paste your reference.
      </p>

      <div className={styles.modalInstructions}>
        <div className={styles.instrRow}>
          <span>1.</span>
          <span>
            HaloPesa → Lipa Number: <strong>25165945</strong> (NABOGAMING)
          </span>
        </div>

        <div className={styles.instrRow}>
          <span>2.</span>
          <span>
            M-Pesa → Lipa Number: <strong>36835506</strong> (STEVEN DAVID)
          </span>
        </div>

        <div className={styles.instrRow}>
          <span>3.</span>
          <span>
            Send TZS {fmtFee(tournament.entrance_fee)} to either option above
          </span>
        </div>

        <div className={styles.instrRow}>
          <span>4.</span>
          <span>
            Copy the transaction reference and enter it below
          </span>
        </div>
      </div>

      <div className={styles.modalField}>
        <label>
          Transaction Reference <span className={styles.req}>*</span>
        </label>
        <input
          type="text"
          placeholder="e.g. QJK2XABCD"
          value={payRef}
          onChange={e => setPayRef(e.target.value)}
        />
      </div>

      <div className={styles.modalField}>
        <label>
          Phone Number <span className={styles.req}>*</span>
        </label>
        <input
          type="tel"
          placeholder="e.g. 0712 345 678"
          value={payPhone}
          onChange={e => setPayPhone(e.target.value)}
        />
      </div>

      {err && (
        <p className={styles.modalErr}>
          <i className="ri-error-warning-line" /> {err}
        </p>
      )}

      <button
        className={styles.modalSubmit}
        onClick={submit}
        disabled={loading}
      >
        {loading ? (
          <>
            <i className="ri-loader-4-line" /> Submitting…
          </>
        ) : (
          <>
            <i className="ri-send-plane-line" /> Submit Payment Proof
          </>
        )}
      </button>
    </div>
  </div>
)
}

/* ── Status Modal (pending/rejected) ── */
function PaymentStatusModal({ status, onClose }) {
  const isPending  = status === 'payment_submitted'
  const isRejected = status === 'rejected'
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}><i className="ri-close-line" /></button>
        <div className={styles.modalIcon} style={{ color: isPending ? '#f59e0b' : '#ef4444' }}>
          <i className={isPending ? 'ri-time-line' : 'ri-close-circle-line'} />
        </div>
        <h3 className={styles.modalTitle}>{isPending ? 'Payment Under Review' : 'Payment Rejected'}</h3>
        <p className={styles.modalSub}>
          {isPending
            ? 'Your payment proof has been submitted. Admin will verify and approve your registration soon.'
            : 'Your payment was rejected. Please check your reference and resubmit, or contact support.'}
        </p>
        <button className={styles.modalSubmit} onClick={onClose}>Got it</button>
      </div>
    </div>
  )
}

export default function Tournaments() {
  const { user, isAdmin } = useAuth()
  const router = useRouter()
  const [tournaments, setTournaments]       = useState([])
  const [loading, setLoading]               = useState(true)
  usePageLoading(loading)
  const [filter, setFilter]                 = useState('all')
  const [registered, setRegistered]         = useState({})    // tournament_id → true
  const [paymentMap, setPaymentMap]         = useState({})    // tournament_id → payment status

  // Modal state
  const [payModal, setPayModal]             = useState(null)  // tournament obj
  const [statusModal, setStatusModal]       = useState(null)  // { status }

  useEffect(() => { loadTournaments() }, [filter])

  useEffect(() => {
    const ch = supabase
      .channel('tourney-list-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, () => {
        loadTournaments()
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  // Load registration status
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

  // Load payment statuses
  useEffect(() => {
    if (!user || tournaments.length === 0) return
    const ids = tournaments.filter(t => t.entrance_fee > 0).map(t => t.id)
    if (!ids.length) return
    supabase.from('tournament_payments')
      .select('tournament_id, status')
      .eq('user_id', user.id)
      .in('tournament_id', ids)
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
    setTournaments(data || [])
    setLoading(false)
  }

  function fillPct(t) {
    const count = t.registered_count || 0
    const slots = t.slots || 1
    return Math.min(100, Math.round((count / slots) * 100))
  }

  function handleRegisterClick(e, t) {
    e.stopPropagation()
    if (!user) { router.push('/login'); return }
    const fee = t.entrance_fee || 0
    if (fee <= 0) {
      // Free tournament — go to detail page for registration
      router.push(`/tournaments/${t.slug || t.id}`)
      return
    }
    // Paid tournament — check existing payment status
    const pmtStatus = paymentMap[t.id]
    if (pmtStatus === 'payment_submitted') { setStatusModal({ status: 'payment_submitted' }); return }
    if (pmtStatus === 'rejected')          { setStatusModal({ status: 'rejected' }); return }
    // No payment yet — open payment modal
    setPayModal(t)
  }

  function onPaymentSubmitted() {
    setPayModal(null)
    setPaymentMap(m => ({ ...m, [payModal.id]: 'payment_submitted' }))
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Season {getCurrentSeason()}</p>
          <h1 className={styles.headline}>TOURNAMENTS</h1>
        </div>
        {user && (
          <button className={styles.createBtn} onClick={() => router.push('/tournaments/create')} title="Create Tournament" aria-label="Create Tournament">
            <i className="ri-add-line" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        {['all', ...GAME_SLUGS].map(f => (
          <button
            key={f}
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
            const pct        = fillPct(t)
            const isFull     = (t.registered_count || 0) >= t.slots
            const isReg      = registered[t.id]
            const hasFee     = (t.entrance_fee || 0) > 0
            const pmtStatus  = paymentMap[t.id]  // undefined | 'payment_submitted' | 'approved' | 'rejected'
            const isPending  = pmtStatus === 'payment_submitted'
            const isApproved = pmtStatus === 'approved'

            return (
              <div key={t.id} className={styles.card} onClick={() => router.push(`/tournaments/${t.slug || t.id}`)}>
                {/* Top row */}
                <div className={styles.cardTop}>
                  <div className={styles.cardMeta}>
                    <Link href={`/games/${t.game_slug}`} className={styles.gameTag} onClick={e => e.stopPropagation()}>
                      {GAME_NAMES[t.game_slug] || t.game_slug}
                    </Link>
                    <span className={`${styles.statusBadge} ${styles[t.status]}`}>{t.status}</span>
                    {/* Fee badge */}
                    {hasFee && (
                      <span className={styles.feeBadge}>
                        <i className="ri-money-dollar-circle-line" /> TZS {fmtFee(t.entrance_fee)}
                      </span>
                    )}
                    {isReg && (
                      <span className={styles.regBadge}>
                        <i className="ri-checkbox-circle-fill" /> Registered
                      </span>
                    )}
                    {isPending && !isReg && (
                      <span className={styles.pendingBadge}>
                        <i className="ri-time-line" /> Awaiting Approval
                      </span>
                    )}
                    {isFull && !isReg && <span className={styles.fullBadge}><i className="ri-lock-line" /> Full</span>}
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

                {/* Slot progress bar */}
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

                {/* Footer — register CTA */}
                <div className={styles.cardFooter}>
                  {isReg ? (
                    <span className={styles.regBadge} style={{ fontSize: 12 }}>
                      <i className="ri-checkbox-circle-fill" /> You&apos;re registered
                    </span>
                  ) : isPending ? (
                    <span className={styles.pendingBadge} style={{ fontSize: 12 }}>
                      <i className="ri-time-line" /> Payment pending approval — tap for status
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
                    <button
                      className={styles.registerBtn}
                      onClick={e => handleRegisterClick(e, t)}
                    >
                      {hasFee
                        ? <><i className="ri-money-dollar-circle-line" /> Register · TZS {fmtFee(t.entrance_fee)}</>
                        : <><i className="ri-add-circle-line" /> Register Free</>
                      }
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
