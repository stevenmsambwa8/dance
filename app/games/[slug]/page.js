'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../../components/AuthProvider'
import { supabase } from '../../../lib/supabase'
import { GAME_META } from '../../../lib/constants'
import styles from './page.module.css'
import usePageLoading from '../../../components/usePageLoading'

function fmtFee(n) { return Number(n).toLocaleString() }

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


// ── Main ──────────────────────────────────────────────────────────────────────
export default function GameDetail() {
  const { slug }   = useParams()
  const router     = useRouter()
  const { user, isAdmin } = useAuth()
  const game = GAME_META[slug]
  if (!game) notFound()

  const [tournaments,  setTournaments]  = useState([])
  const [loading,      setLoading]      = useState(true)
  usePageLoading(loading)
  const [subscribed,   setSubscribed]   = useState(false)
  const [subCount,     setSubCount]     = useState(0)
  const [selected,     setSelected]     = useState(null)   // tournament object for detail sheet
  const [registered,   setRegistered]   = useState({})     // tournament_id → true
  const [paymentMap,   setPaymentMap]   = useState({})     // tournament_id → payment status
  const [payModal,     setPayModal]     = useState(null)   // tournament for payment modal
  const [tab,          setTab]          = useState('active') // 'active' | 'ongoing'

  useEffect(() => { loadData() }, [slug, user])

  async function loadData() {
    setLoading(true)
    const [{ data: tourns }, { count: subs }] = await Promise.all([
      supabase.from('tournaments')
        .select('id, name, slug, game_slug, status, slots, registered_count, date, prize, format, entrance_fee, is_test, created_by, created_at')
        .eq('game_slug', slug)
        .in('status', ['active', 'ongoing'])
        .order('created_at', { ascending: false }),
      supabase.from('game_subscriptions')
        .select('*', { count: 'exact', head: true }).eq('game_slug', slug),
    ])

    // Filter out test tournaments for non-creator / non-admin
    const visible = (tourns || []).filter(t => {
      if (!t.is_test) return true
      if (!user)      return false
      return isAdmin || t.created_by === user.id
    })
    setTournaments(visible)
    setSubCount(subs || 0)

    if (user) {
      const [{ data: sub }, { data: regs }] = await Promise.all([
        supabase.from('game_subscriptions').select('user_id').eq('user_id', user.id).eq('game_slug', slug).maybeSingle(),
        supabase.from('tournament_participants').select('tournament_id').eq('user_id', user.id),
      ])
      setSubscribed(!!sub)
      if (regs) {
        const map = {}
        regs.forEach(r => { map[r.tournament_id] = true })
        setRegistered(map)
      }

      // Load payment status for paid tournaments
      const paidIds = visible.filter(t => (t.entrance_fee || 0) > 0).map(t => t.id)
      if (paidIds.length) {
        const { data: pmts } = await supabase.from('tournament_payments')
          .select('tournament_id, status').eq('user_id', user.id).in('tournament_id', paidIds)
        if (pmts) {
          const pmap = {}
          pmts.forEach(p => { pmap[p.tournament_id] = p.status })
          setPaymentMap(pmap)
        }
      }
    }
    setLoading(false)
  }

  async function toggleSubscribe() {
    if (!user) { router.push('/login'); return }
    if (subscribed) {
      await supabase.from('game_subscriptions').delete().eq('user_id', user.id).eq('game_slug', slug)
      setSubCount(c => Math.max(0, c - 1))
    } else {
      await supabase.from('game_subscriptions').insert({ user_id: user.id, game_slug: slug })
      setSubCount(c => c + 1)
    }
    setSubscribed(s => !s)
  }

  // Free tournament — direct register
  async function registerTournament(t) {
    if (!user) { router.push('/login'); return }
    const { error } = await supabase.from('tournament_participants')
      .insert({ tournament_id: t.id, user_id: user.id })
    if (error) return

    const { count } = await supabase.from('tournament_participants')
      .select('*', { count: 'exact', head: true }).eq('tournament_id', t.id)
    if (count !== null) await supabase.from('tournaments').update({ registered_count: count }).eq('id', t.id)
    const newCount = count ?? (t.registered_count || 0) + 1

    setRegistered(r => ({ ...r, [t.id]: true }))
    setTournaments(ts => ts.map(x => x.id === t.id ? { ...x, registered_count: newCount } : x))
    if (selected?.id === t.id) setSelected(prev => ({ ...prev, registered_count: newCount }))

    // Place in bracket
    const { data: tData } = await supabase.from('tournaments').select('bracket_data').eq('id', t.id).single()
    if (tData?.bracket_data) {
      try {
        const bd = typeof tData.bracket_data === 'string' ? JSON.parse(tData.bracket_data) : tData.bracket_data
        if (bd?.rounds) {
          const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle()
          const playerSlot = { userId: user.id, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }
          let pick = null
          bd.rounds[0]?.forEach((pair, pi) => {
            pair.forEach((s, si) => {
              if (!pick && !s?.userId && (s?.status === 'open' || s?.status === 'bye')) pick = { pi, si }
            })
          })
          if (pick) {
            const newRounds = bd.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => {
              if (pi !== pick.pi) return pair
              return pair.map((s, si) => si === pick.si ? playerSlot : s)
            }))
            await supabase.from('tournaments').update({ bracket_data: { ...bd, rounds: newRounds, isEmpty: false } }).eq('id', t.id)
          }
        }
      } catch {}
    }
  }

  function handleRowClick(t) {
    // Don't open modal for ongoing — go straight to detail page
    if (t.status === 'ongoing') {
      router.push(`/tournaments/${t.slug || t.id}`)
      return
    }
    setSelected(t)
  }

  function handleModalRegister() {
    if (!selected) return
    const hasFee    = (selected.entrance_fee || 0) > 0
    const isJoined  = !!registered[selected.id]
    const pmtStatus = paymentMap[selected.id]
    if (isJoined || hasFee) return // handled by button logic
    registerTournament(selected).then(() => setSelected(null))
  }

  function onPaymentSubmitted(tournamentId) {
    setPayModal(null)
    setSelected(null)
    setPaymentMap(m => ({ ...m, [tournamentId]: 'payment_submitted' }))
  }

  // Split tournaments by status for the tab UI
  const activeTournaments  = tournaments.filter(t => t.status === 'active')
  const ongoingTournaments = tournaments.filter(t => t.status === 'ongoing')
  const displayList = tab === 'ongoing' ? ongoingTournaments : activeTournaments

  return (
    <div className={styles.page}>

      {/* ── Hero ── */}
      <div className={styles.hero}>
        {game.image && <div className={styles.heroBg} style={{ backgroundImage: `url(${game.image})` }} />}
        <Link href="/games" className={styles.back}><i className="ri-arrow-left-line" /> All Games</Link>
        <div className={styles.heroInner}>
          <div className={styles.heroFlex}>
            <div className={styles.heroLeft}>
              <div className={styles.genreRow}>
                <span className={styles.genreChip}>{game.genre}</span>
              </div>
              <h1 className={styles.heroName}>{game.name}</h1>
              {game.full && <p className={styles.heroFull}>{game.full}</p>}
            </div>
            {game.image && (
              <div className={styles.heroLogoWrap}>
                <img src={game.image} alt={game.name} className={styles.heroLogo} />
              </div>
            )}
          </div>
          <div className={styles.statsStrip}>
            <div className={styles.stat}>
              <span className={styles.statVal}>{loading ? '—' : subCount.toLocaleString()}</span>
              <span className={styles.statLabel}>Subscribers</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>{loading ? '—' : activeTournaments.length}</span>
              <span className={styles.statLabel}>Active</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal} style={{ color: ongoingTournaments.length > 0 ? '#6366f1' : undefined }}>
                {loading ? '—' : ongoingTournaments.length}
              </span>
              <span className={styles.statLabel}>Ongoing</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Description ── */}
      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      {/* ── Subscribe + Group Chat ── */}
      <div className={styles.subRow}>
        <button className={`${styles.subBtn} ${subscribed ? styles.subActive : ''}`} onClick={toggleSubscribe}>
          <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} />
          {subscribed ? 'Subscribed' : 'Subscribe'}
        </button>
        <Link href={`/games/${slug}/chat`} className={styles.chatBtn}>
          <i className="ri-group-line" /> Group Chat
        </Link>
        <Link href="/tournaments/create" className={styles.createBtn}>
          <i className="ri-add-line" /> Create Tournament
        </Link>
      </div>

      {/* ── Tournaments ── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Tournaments</h2>
          {/* Tab switcher */}
          {!loading && (activeTournaments.length > 0 || ongoingTournaments.length > 0) && (
            <div className={styles.tabRow}>
              <button className={`${styles.tabBtn} ${tab === 'active' ? styles.tabActive : ''}`} onClick={() => setTab('active')}>
                Active {activeTournaments.length > 0 && <span>{activeTournaments.length}</span>}
              </button>
              <button className={`${styles.tabBtn} ${tab === 'ongoing' ? styles.tabActiveOngoing : ''}`} onClick={() => setTab('ongoing')}>
                Ongoing {ongoingTournaments.length > 0 && <span style={{ background: '#6366f1' }}>{ongoingTournaments.length}</span>}
              </button>
            </div>
          )}
        </div>

        {!loading && displayList.length === 0 && (
          <div className={styles.emptyWrap}>
            <i className={tab === 'ongoing' ? 'ri-play-circle-line' : 'ri-node-tree'} />
            <p>{tab === 'ongoing' ? 'No ongoing tournaments right now.' : 'No active tournaments for this game yet.'}</p>
            <Link href="/tournaments" className={styles.emptyLink}>Browse all tournaments <i className="ri-arrow-right-line" /></Link>
          </div>
        )}

        {!loading && displayList.length > 0 && (
          <div className={styles.list}>
            {displayList.map(t => {
              const isRowJoined  = !!registered[t.id]
              const hasFee       = (t.entrance_fee || 0) > 0
              const pmtStatus    = paymentMap[t.id]
              const isPending    = pmtStatus === 'payment_submitted'
              const isRowFull    = (t.registered_count || 0) >= t.slots && !isRowJoined
              const fillPct      = Math.min(100, ((t.registered_count || 0) / (t.slots || 1)) * 100)
              const isOngoing    = t.status === 'ongoing'

              return (
                <div
                  key={t.id}
                  className={`${styles.tRow} ${isRowFull && !isOngoing ? styles.tRowFull : ''} ${isRowJoined ? styles.tRowJoined : ''} ${isOngoing ? styles.tRowOngoing : ''}`}
                  onClick={() => handleRowClick(t)}
                >
                  <div className={styles.tInfo}>
                    <div className={styles.tTopRow}>
                      <span className={styles.tName}>{t.name}</span>
                      <div className={styles.tBadges}>
                        {/* Status badge */}
                        <span className={isOngoing ? styles.badgeOngoing : styles.badgeActive}>
                          <i className={isOngoing ? 'ri-play-circle-fill' : 'ri-live-line'} />
                          {t.status}
                        </span>
                        {/* Test badge */}
                        {t.is_test && (
                          <span className={styles.badgeTest}><i className="ri-flask-line" /> Test</span>
                        )}
                        {/* Fee badge */}
                        {hasFee && (
                          <span className={styles.badgeFee}><i className="ri-money-dollar-circle-line" /> TZS {fmtFee(t.entrance_fee)}</span>
                        )}
                      </div>
                    </div>
                    {t.format && <div className={styles.tFormat}>{t.format}</div>}
                    <div className={styles.slotBar}>
                      <div className={styles.slotTrack}>
                        <div className={`${styles.slotFill} ${isRowFull ? styles.slotFull : fillPct >= 80 ? styles.slotWarm : ''}`}
                          style={{ width: `${fillPct}%` }} />
                      </div>
                      <span className={styles.slotText}>{t.registered_count || 0}/{t.slots}</span>
                      {fillPct >= 80 && !isRowFull && <i className="ri-fire-line" style={{ fontSize: 11, color: '#f97316' }} />}
                    </div>
                  </div>

                  <div className={styles.tMeta}>
                    {t.prize && <span className={styles.tPrize}><i className="ri-trophy-line" />{t.prize}</span>}
                    {t.date  && <span className={styles.tDate}><i className="ri-calendar-line" />{t.date}</span>}
                  </div>

                  {/* Right status pill */}
                  {isOngoing ? (
                    <span className={styles.badgeView}><i className="ri-arrow-right-line" /> View</span>
                  ) : isRowJoined ? (
                    <span className={styles.badgeJoined}><i className="ri-checkbox-circle-fill" /> Joined</span>
                  ) : isPending ? (
                    <span className={styles.badgePending}><i className="ri-time-line" /> Pending</span>
                  ) : isRowFull ? (
                    <span className={styles.badge + ' ' + styles.badgeFull}>Full</span>
                  ) : hasFee ? (
                    <span className={styles.badgePay}><i className="ri-money-dollar-circle-line" /> Pay</span>
                  ) : (
                    <span className={styles.badgeOpen}>Open</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Tournament Detail Bottom Sheet ── */}
      {selected && (() => {
        const isJoined  = !!registered[selected.id]
        const hasFee    = (selected.entrance_fee || 0) > 0
        const pmtStatus = paymentMap[selected.id]
        const isPending = pmtStatus === 'payment_submitted'
        const isFull    = (selected.registered_count || 0) >= selected.slots && !isJoined

        return (
          <div className={styles.modalBackdrop} onClick={() => setSelected(null)}>
            <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
              <button className={styles.modalClose} onClick={() => setSelected(null)}><i className="ri-close-line" /></button>

              <h3 className={styles.detailTitle}>{selected.name}</h3>
              {selected.format && <p className={styles.detailFormat}>{selected.format}</p>}

              {isJoined && (
                <div className={styles.joinedBanner}>
                  <i className="ri-checkbox-circle-fill" /> You&apos;re registered for this tournament
                </div>
              )}
              {isPending && !isJoined && (
                <div className={styles.pendingBanner}>
                  <i className="ri-time-line" /> Payment submitted — awaiting admin approval
                </div>
              )}

              <div className={styles.tGrid}>
                {[
                  { label: 'Status',     val: selected.status, icon: 'ri-live-line' },
                  { label: 'Prize Pool', val: selected.prize || 'None', icon: 'ri-trophy-line' },
                  { label: 'Entry Fee',  val: hasFee ? `TZS ${fmtFee(selected.entrance_fee)}` : 'Free', icon: 'ri-money-dollar-circle-line' },
                  { label: 'Slots',      val: `${selected.registered_count || 0} / ${selected.slots}`, icon: 'ri-group-line' },
                  { label: 'Date',       val: selected.date || 'TBD', icon: 'ri-calendar-line' },
                ].map(r => (
                  <div key={r.label} className={styles.tGridRow}>
                    <span className={styles.tGridLabel}><i className={r.icon} /> {r.label}</span>
                    <span className={styles.tGridVal}>{r.val}</span>
                  </div>
                ))}
              </div>

              {!isJoined && !isPending && !isFull && (
                <p className={styles.tNote}>
                  By registering you agree to tournament rules. No-shows result in a loss of entry points.
                </p>
              )}

              {/* Action buttons */}
              <div className={styles.detailActions}>
                <Link href={`/tournaments/${selected.slug || selected.id}`} className={styles.viewBtn}>
                  <i className="ri-eye-line" /> View Bracket
                </Link>
                {!isJoined && !isFull && !isPending && (
                  hasFee ? (
                    <button className={styles.joinBtn} onClick={() => { setSelected(null); setPayModal(selected) }}>
                      <i className="ri-money-dollar-circle-line" /> Pay & Register · TZS {fmtFee(selected.entrance_fee)}
                    </button>
                  ) : (
                    <button className={styles.joinBtn} onClick={() => registerTournament(selected).then(() => setSelected(null))}>
                      <i className="ri-trophy-line" /> Register Now
                    </button>
                  )
                )}
                {isFull && !isJoined && (
                  <span className={styles.fullNote}><i className="ri-lock-line" /> Tournament is full</span>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Payment Modal ── */}
      {payModal && (
        <PaymentModal
          tournament={payModal}
          user={user}
          onClose={() => setPayModal(null)}
          onSubmitted={onPaymentSubmitted}
        />
      )}
    </div>
  )
}
