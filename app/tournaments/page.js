'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'
import { useCurrency } from '../../lib/useCurrency'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'
import { getCurrentSeason } from '../../lib/seasons'
import { getActivePlan } from '../../lib/plans'
import useTranslation from '../../lib/useTranslation'

function parsePrize(raw) {
  if (!raw) return null
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? null : n
}

const GAME_NAMES = Object.fromEntries(GAME_SLUGS.map(s => [s, GAME_META[s].name]))
function fmtFee(n) { return Number(n).toLocaleString() }

const FREE_LIMIT_FREE_TOURNEYS = 2
const FREE_LIMIT_PAID_TOURNEYS = 1

function SkeletonCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonBanner} />
      <div className={styles.skeletonBody}>
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
    </div>
  )
}

function PaymentModal({ tournament, user, onClose, onSubmitted }) {
  const { t } = useTranslation()
  const [payRef,   setPayRef]   = useState('')
  const [payPhone, setPayPhone] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState('')
  const [copied,   setCopied]   = useState(null)

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
    if (!payRef.trim() && !payPhone.trim()) { setErr(t('tournamentsPage.enterTxnOrPhone')); return }
    setLoading(true); setErr('')
    const { data: existing } = await supabase
      .from('tournament_payments').select('id, status')
      .eq('tournament_id', tournament.id).eq('user_id', user.id).maybeSingle()
    if (existing?.status === 'approved')          { setErr(t('tournamentsPage.alreadyApprovedRefresh')); setLoading(false); return }
    if (existing?.status === 'payment_submitted') { setErr(t('tournamentsPage.alreadySubmittedAwaiting')); setLoading(false); return }
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
            <h3 className={styles.payTitle}>{t('tournamentsPage.sendEntryFee')}</h3>
            <p className={styles.paySub}>{t('tournamentsPage.chooseAccountSendInstructions')} <strong>TZS {fmtFee(tournament.entrance_fee)}</strong>, {t('tournamentsPage.thenSubmitProof')}</p>
          </div>
        </div>
        <div className={styles.payAmountPill}>
          <span>{t('tournamentsPage.amountToSend')}</span>
          <strong>TZS {fmtFee(tournament.entrance_fee)}</strong>
        </div>
        <p className={styles.payChooseLabel}><span>{t('tournamentsPage.chooseOneAccount')}</span></p>
        <div className={styles.payGrid}>
          <div className={styles.payCard}>
            <div className={styles.payCardHead}><i className="ri-sim-card-line" style={{ color: '#e11d48' }} /><span>Halopesa</span></div>
            <div className={styles.payCardNum}>
              <span>25165945</span>
              <button className={`${styles.copyBtn} ${copied === 'halo' ? styles.copyBtnDone : ''}`} onClick={() => copyNumber('halo', '25165945')}>
                {copied === 'halo' ? <><i className="ri-check-line" /> {t('tournamentsPage.copied')}</> : <><i className="ri-file-copy-line" /> {t('tournamentsPage.copy')}</>}
              </button>
            </div>
            <div className={styles.payCardMeta}><span>{t('tournamentsPage.lipaNumber')}</span><span className={styles.payCardAcct}>NABOGAMING</span></div>
          </div>
          <div className={styles.payCard}>
            <div className={styles.payCardHead}><i className="ri-sim-card-2-line" style={{ color: '#16a34a' }} /><span>M-Pesa</span></div>
            <div className={styles.payCardNum}>
              <span>36835506</span>
              <button className={`${styles.copyBtn} ${copied === 'mpesa' ? styles.copyBtnDone : ''}`} onClick={() => copyNumber('mpesa', '36835506')}>
                {copied === 'mpesa' ? <><i className="ri-check-line" /> {t('tournamentsPage.copied')}</> : <><i className="ri-file-copy-line" /> {t('tournamentsPage.copy')}</>}
              </button>
            </div>
            <div className={styles.payCardMeta}><span>{t('tournamentsPage.lipaNumber')}</span><span className={styles.payCardAcct}>STEVEN DAVID</span></div>
          </div>
        </div>
        <p className={styles.payProofLabel}>{t('tournamentsPage.afterPayingPaste')}</p>
        <div className={styles.modalField}>
          <label><i className="ri-fingerprint-line" /> {t('tournamentsPage.transactionIdRef')} <span className={styles.req}>*</span></label>
          <input type="text" placeholder="e.g. ABC12345XY" value={payRef} onChange={e => setPayRef(e.target.value)} />
        </div>
        <div className={styles.modalField}>
          <label><i className="ri-phone-line" /> {t('tournamentsPage.phoneNumberUsed')}</label>
          <input type="tel" placeholder="e.g. 0712 345 678" value={payPhone} onChange={e => setPayPhone(e.target.value)} />
        </div>
        {err && <p className={styles.modalErr}><i className="ri-error-warning-line" /> {err}</p>}
        <button className={styles.modalSubmit} onClick={submit} disabled={loading || (!payRef.trim() && !payPhone.trim())}>
          {loading ? <><i className="ri-loader-4-line" /> {t('tournamentsPage.submitting')}</> : <><i className="ri-check-double-line" /> {t('tournamentsPage.ivePaidNotifyAdmin')}</>}
        </button>
      </div>
    </div>
  )
}

function PaymentStatusModal({ status, onClose }) {
  const { t } = useTranslation()
  const isPending = status === 'payment_submitted'
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}><i className="ri-close-line" /></button>
        <i className={`${isPending ? 'ri-time-line' : 'ri-close-circle-line'} ${styles.modalIcon}`}
           style={{ color: isPending ? '#f59e0b' : '#ef4444' }} />
        <h3 className={styles.modalTitle}>{isPending ? t('tournamentsPage.paymentUnderReview') : t('tournamentsPage.paymentRejectedTitle')}</h3>
        <p className={styles.modalSub}>
          {isPending
            ? t('tournamentsPage.paymentUnderReviewMsg')
            : t('tournamentsPage.paymentRejectedMsg')}
        </p>
        <button className={styles.modalSubmit} onClick={onClose}>{t('tournamentsPage.gotIt')}</button>
      </div>
    </div>
  )
}

function FreeLimitModal({ onClose, onUpgrade }) {
  const { t } = useTranslation()
  return (
    <div className={styles.popupBackdrop} onClick={onClose}>
      <div className={styles.popupCard} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}><i className="ri-close-line" /></button>
        <div className={styles.popupIcon}><i className="ri-shield-star-line" /></div>
        <h3 className={styles.popupTitle}>{t('tournamentsPage.limitReachedTitle')}</h3>
        <p className={styles.popupSub}>
          {t('tournamentsPage.limitReachedMsg1')} <strong>{FREE_LIMIT_FREE_TOURNEYS} {t('tournamentsPage.limitReachedMsg2')}</strong>{' '}
          <strong>{FREE_LIMIT_PAID_TOURNEYS}</strong> {t('tournamentsPage.limitReachedMsg3')}
        </p>
        <button className={styles.popupUpgradeBtn} onClick={onUpgrade}>
          <i className="ri-vip-diamond-line" /> {t('tournamentsPage.upgradeToElite')}
        </button>
        <button className={styles.popupCancelBtn} onClick={onClose}>{t('tournamentsPage.maybeLater')}</button>
      </div>
    </div>
  )
}

export default function Tournaments() {
  const { user, isAdmin, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()
  const { fmtAmt } = useCurrency(profile?.country_flag ?? null)
  const { t } = useTranslation()

  const [tournaments, setTournaments] = useState([])
  const [loading,     setLoading]     = useState(true)
  usePageLoading(loading)

  const [filter,      setFilter]      = useState('all')
  const [registered,  setRegistered]  = useState({})
  const [paymentMap,  setPaymentMap]  = useState({})
  const [myCreated,   setMyCreated]   = useState([])
  const [payModal,    setPayModal]    = useState(null)
  const [statusModal, setStatusModal] = useState(null)
  const [limitModal,  setLimitModal]  = useState(false)

  useEffect(() => { loadTournaments() }, [filter])

  useEffect(() => {
    const ch = supabase.channel(`tourney-list-count-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, loadTournaments)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

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

  useEffect(() => {
    if (!user || tournaments.length === 0) return
    const paidIds = tournaments.filter(tour => (tour.entrance_fee || 0) > 0).map(tour => tour.id)
    if (!paidIds.length) return
    supabase.from('tournament_payments').select('tournament_id, status')
      .eq('user_id', user.id).in('tournament_id', paidIds)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(r => { map[r.tournament_id] = r.status })
        setPaymentMap(map)
      })
  }, [user, tournaments.length])

  useEffect(() => {
    if (!user) return
    supabase.from('tournaments').select('id, entrance_fee').eq('created_by', user.id)
      .then(({ data }) => setMyCreated(data || []))
  }, [user])

  async function loadTournaments() {
    setLoading(true)
    let q = supabase.from('tournaments').select('*').order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('game_slug', filter)
    const { data } = await q
    const all = data || []
    const visible = all.filter(tour => {
      if (!tour.is_test) return true
      if (!user) return false
      return isAdmin || tour.created_by === user.id
    })
    setTournaments(visible)
    setLoading(false)
  }

  const activePlan = getActivePlan(profile)
  const isPaidPlan = activePlan === 'pro' || activePlan === 'elite' || activePlan === 'team'
  const canCreateUnlimited = isAdmin || isPaidPlan

  function handleCreateClick() {
    if (!user) { openAuthGate(); return }
    if (canCreateUnlimited) { router.push('/tournaments/create'); return }
    const myFree = myCreated.filter(tour => !parsePrize(tour.entrance_fee)).length
    const myPaid = myCreated.filter(tour =>  parsePrize(tour.entrance_fee)).length
    if (myFree >= FREE_LIMIT_FREE_TOURNEYS && myPaid >= FREE_LIMIT_PAID_TOURNEYS) {
      setLimitModal(true); return
    }
    router.push('/tournaments/create')
  }

  function fillPct(tour) {
    return Math.min(100, Math.round(((tour.registered_count || 0) / (tour.slots || 1)) * 100))
  }

  function handleRegisterClick(e, tour) {
    e.stopPropagation()
    if (!user) { openAuthGate(); return }
    const hasFee = (tour.entrance_fee || 0) > 0
    if (!hasFee) { router.push(`/tournaments/${tour.slug || tour.id}`); return }
    const pmtStatus = paymentMap[tour.id]
    if (pmtStatus === 'payment_submitted') { setStatusModal({ status: 'payment_submitted' }); return }
    if (pmtStatus === 'rejected')          { setStatusModal({ status: 'rejected' }); return }
    setPayModal(tour)
  }

  function onPaymentSubmitted(tournamentId) {
    setPayModal(null)
    setPaymentMap(m => ({ ...m, [tournamentId]: 'payment_submitted' }))
  }

  const myFreeCount = myCreated.filter(tour => !parsePrize(tour.entrance_fee)).length
  const myPaidCount = myCreated.filter(tour =>  parsePrize(tour.entrance_fee)).length
  const showQuota = user && !canCreateUnlimited

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t('season.season')} {getCurrentSeason()}</p>
          <h1 className={styles.headline}>{t('tournamentsPage.title')}</h1>
        </div>
        {user && (
          <button className={styles.createBtn} onClick={handleCreateClick} aria-label="Create Tournament">
            <i className="ri-add-line" />
            <span>{t('tournamentsPage.createBtn')}</span>
          </button>
        )}
      </div>

      {showQuota && (
        <div className={styles.quotaBar}>
          <i className="ri-information-line" />
          <span>
            {t('tournamentsPage.freePlanPrefix')} <strong>{myFreeCount}/{FREE_LIMIT_FREE_TOURNEYS}</strong> {t('tournamentsPage.freeUsed')} &amp; <strong>{myPaidCount}/{FREE_LIMIT_PAID_TOURNEYS}</strong> {t('tournamentsPage.paidUsed')} {t('tournamentsPage.created')}
          </span>
          <button className={styles.quotaUpgradeBtn} onClick={() => router.push('/upgrade')}>{t('tournamentsPage.upgrade')}</button>
        </div>
      )}

      <div className={styles.filters}>
        {['all', ...GAME_SLUGS].map(f => (
          <button key={f}
            className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
            onClick={() => setFilter(f)}
          >{f === 'all' ? t('tournamentsPage.allGamesFilter') : GAME_NAMES[f] || f}</button>
        ))}
      </div>

      {loading && (
        <div className={styles.list}>
          {[1,2,3].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {!loading && tournaments.length === 0 && (
        <div className={styles.empty}>
          <i className="ri-tournament-line" />
          <p>{t('tournamentsPage.noTournamentsFound')}</p>
          <span>{t('tournamentsPage.checkBackLater')}</span>
        </div>
      )}

      {!loading && tournaments.length > 0 && (
        <div className={styles.list}>
          {tournaments.map(tour => {
            const pct       = fillPct(tour)
            const isFull    = (tour.registered_count || 0) >= tour.slots
            const isReg     = registered[tour.id]
            const hasFee    = !!parsePrize(tour.entrance_fee)
            const pmtStatus = paymentMap[tour.id]
            const isPending = pmtStatus === 'payment_submitted'
            const isActive  = tour.status === 'active'
            const isOngoing = tour.status === 'ongoing'

            return (
              <div key={tour.id} className={styles.card}
                onClick={() => router.push(`/tournaments/${tour.slug || tour.id}`)}>

                <div className={styles.cardBanner}>
                  {GAME_META[tour.game_slug]?.image
                    ? <img src={GAME_META[tour.game_slug].image} alt={GAME_NAMES[tour.game_slug]} className={styles.cardBannerImg} />
                    : <div className={styles.cardBannerFallback}><i className="ri-gamepad-line" /></div>
                  }
                  <div className={styles.cardBannerOverlay}>
                    <span className={`${styles.statusBadge} ${styles[tour.status]}`}>{tour.status}</span>
                    {tour.is_test && <span className={styles.testBadge}><i className="ri-flask-line" /> {t('tournamentsPage.test')}</span>}
                    {hasFee   && <span className={styles.feeBadge}><i className="ri-money-dollar-circle-line" /> {t('tournamentsPage.paid')}</span>}
                  </div>
                  <div className={styles.cardBannerRight}>
                    {isReg              && <span className={styles.regPip}><i className="ri-checkbox-circle-fill" /></span>}
                    {isPending && !isReg && <span className={styles.pendingPip}><i className="ri-time-line" /></span>}
                    {isFull    && !isReg && <span className={styles.fullPip}><i className="ri-lock-line" /></span>}
                  </div>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.cardTop}>
                    <Link href={`/games/${tour.game_slug}`} className={styles.gameTag} onClick={e => e.stopPropagation()}>
                      {GAME_NAMES[tour.game_slug] || tour.game_slug}
                    </Link>
                    {tour.date && <span className={styles.datePill}><i className="ri-calendar-line" />{tour.date}</span>}
                  </div>

                  <h3 className={styles.cardName}>{tour.name}</h3>
                  {tour.description && <p className={styles.cardDesc}>{tour.description}</p>}

                  <div className={styles.statsRow}>
                    <div className={styles.statChip}>
                      <i className="ri-gamepad-line" /><span>{tour.format || t('tournamentsPage.open')}</span>
                    </div>
                    <div className={styles.statChip} style={{ color: hasFee ? '#f59e0b' : 'var(--text-muted)' }}>
                      <i className="ri-money-dollar-circle-line" /><span>{hasFee ? fmtAmt(parsePrize(tour.entrance_fee)) : t('tournamentsPage.freeEntry')}</span>
                    </div>
                    <div className={styles.statChip} style={{ color: parsePrize(tour.prize) ? '#22c55e' : 'var(--text-muted)' }}>
                      <i className="ri-trophy-line" /><span>{parsePrize(tour.prize) ? fmtAmt(parsePrize(tour.prize)) : t('tournamentsPage.noPrize')}</span>
                    </div>
                  </div>

                  <div className={styles.slotRow}>
                    <span className={styles.slotLabel}><i className="ri-group-line" /> {tour.registered_count || 0}/{tour.slots}</span>
                    <div className={styles.slotTrack}>
                      <div className={`${styles.slotFill} ${isFull ? styles.slotFull : pct >= 80 ? styles.slotWarm : ''}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`${styles.slotPct} ${pct >= 80 ? styles.slotHot : ''}`}>
                      {pct}%{pct >= 80 && <i className="ri-fire-line" />}
                    </span>
                  </div>

                  <div className={styles.cardFooter}>
                    <div className={styles.footerLeft}>
                      {isReg ? (
                        <span className={styles.regBadge}><i className="ri-checkbox-circle-fill" /> {t('tournamentsPage.registered')}</span>
                      ) : isPending ? (
                        <span className={styles.pendingBadge}><i className="ri-time-line" /> {t('tournamentsPage.paymentPending')}</span>
                      ) : isFull ? (
                        <span className={styles.fullBadge}><i className="ri-lock-line" /> {t('tournamentsPage.full')}</span>
                      ) : !isActive && !isOngoing ? (
                        <span className={styles.viewLink}>{t('tournamentsPage.viewDetails')} <i className="ri-arrow-right-line" /></span>
                      ) : (
                        <button className={styles.registerBtn} onClick={e => handleRegisterClick(e, tour)}>
                          {hasFee
                            ? <><i className="ri-money-dollar-circle-line" /> {t('tournamentsPage.joinFee')} {fmtAmt(parsePrize(tour.entrance_fee))}</>
                            : <><i className="ri-add-circle-line" /> {t('tournamentsPage.joinFreeBtn')}</>}
                        </button>
                      )}
                    </div>
                    <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)', fontSize: 18 }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {payModal    && <PaymentModal tournament={payModal} user={user} onClose={() => setPayModal(null)} onSubmitted={onPaymentSubmitted} />}
      {statusModal && <PaymentStatusModal status={statusModal.status} onClose={() => setStatusModal(null)} />}
      {limitModal  && <FreeLimitModal onClose={() => setLimitModal(false)} onUpgrade={() => { setLimitModal(false); router.push('/upgrade') }} />}
    </div>
  )
}
