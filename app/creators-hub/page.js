'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import { GAME_META } from '../../lib/constants'
import { getActivePlan } from '../../lib/plans'
import { useCurrency } from '../../lib/useCurrency'
import styles from './page.module.css'

/**
 * Creators Hub — access is granted two ways:
 *   1. profiles.is_creator = true (manually approved via application), or
 *   2. the person has already created a tournament before (tournaments.
 *      created_by = user.id) — e.g. they were Elite previously, or an admin
 *      made one for them. That history alone qualifies them; they shouldn't
 *      have to apply and wait for something they already do. When detected,
 *      we also flip profiles.is_creator to true in the background so future
 *      loads (and anything else that checks that column directly) see them
 *      as a creator without re-running this check.
 *
 *   - Not logged in           → auth gate.
 *   - Logged in, no access    → application pitch + apply button. Applying
 *     sets creator_applied_at (persists across reloads) and notifies admins;
 *     approval from there is manual — no self-serve auto-approve besides
 *     the "already created one" bypass above.
 *   - Logged in, has access   → dashboard: stats, upgrade nudge, hosting
 *     tips, create-tournament shortcut, and their tournament list.
 */
export default function CreatorsHubPage() {
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const { fmtAmt } = useCurrency(profile?.country_flag)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [myTournaments, setMyTournaments] = useState([])
  const [loadingTournaments, setLoadingTournaments] = useState(false)
  const [participantCount, setParticipantCount] = useState(0)
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [isCreator, setIsCreator] = useState(false)
  const [earningsTotal, setEarningsTotal] = useState(0)

  const MONEY_TYPES = new Set(['prize', 'join_bonus', 'full_bonus', 'shop_payout'])

  const activePlan = getActivePlan(profile)
  const hasCreatorPerks = activePlan === 'elite' || activePlan === 'team'

  // Resolve access: explicit is_creator flag, or grandfather in anyone who
  // already has a tournament under their name.
  useEffect(() => {
    if (!user) { setCheckingAccess(false); return }
    if (profile?.is_creator) { setIsCreator(true); setCheckingAccess(false); return }

    let cancelled = false
    supabase
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .then(async ({ count }) => {
        if (cancelled) return
        if (count > 0) {
          setIsCreator(true)
          await supabase.from('profiles').update({ is_creator: true }).eq('id', user.id)
        }
        setCheckingAccess(false)
      })
    return () => { cancelled = true }
  }, [user, profile?.is_creator])

  useEffect(() => {
    if (!user || !isCreator) return
    setLoadingTournaments(true)
    supabase
      .from('tournaments')
      .select('id, name, game_slug, status, entrance_fee, slots, registered_count, created_at')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .then(async ({ data }) => {
        setMyTournaments(data || [])
        setLoadingTournaments(false)
        const ids = (data || []).map(t => t.id)
        if (ids.length) {
          const { count } = await supabase
            .from('tournament_participants')
            .select('*', { count: 'exact', head: true })
            .in('tournament_id', ids)
          setParticipantCount(count || 0)
        }
      })
  }, [user, isCreator])

  useEffect(() => {
    if (!user || !isCreator) return
    supabase.from('earnings_log').select('points, type').eq('user_id', user.id)
      .then(({ data }) => {
        if (!data) return
        const total = data.filter(l => MONEY_TYPES.has(l.type)).reduce((s, l) => s + (l.points ?? 0), 0)
        setEarningsTotal(total)
      })
  }, [user, isCreator])

  useEffect(() => {
    if (profile?.creator_applied_at) setApplied(true)
  }, [profile?.creator_applied_at])

  async function handleApply() {
    if (!user) { openAuthGate(); return }
    setApplying(true)
    try {
      await supabase.from('profiles').update({ creator_applied_at: new Date().toISOString() }).eq('id', user.id)

      const { data: admins } = await supabase.from('profiles').select('id')
        .in('email', ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com'])
      if (admins?.length) {
        await supabase.from('notifications').insert(admins.map(a => ({
          user_id: a.id,
          title: '🎬 New Creators Hub Application',
          body: `${profile?.username || 'A player'} applied to join the Creators Hub.`,
          type: 'creator_application',
          meta: { applicant_id: user.id, action: 'review_creator_application' },
          read: false,
        })))
      }
      setApplied(true)
    } finally {
      setApplying(false)
    }
  }

  if (!user) {
    return (
      <div className={styles.page}>
        <div className={styles.gateCard}>
          <div className={styles.gateIcon}><i className="ri-vidicon-fill" /></div>
          <h2 className={styles.gateTitle}>Creators Hub</h2>
          <p className={styles.gateSub}>Sign in to apply or manage your tournaments.</p>
          <button className={styles.primaryBtn} onClick={openAuthGate}>Sign In</button>
        </div>
      </div>
    )
  }

  if (checkingAccess) {
    return <div className={styles.page} />
  }

  if (!isCreator) {
    return (
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className={styles.heroIcon}><i className="ri-vidicon-fill" /></div>
          <h1 className={styles.heroTitle}>Creators Hub</h1>
          <p className={styles.heroSub}>Host tournaments, build a following, get recognized as a verified organizer on Nabogaming.</p>
        </div>

        <div className={styles.perksCard}>
          <div className={styles.perkRow}><i className="ri-shield-star-fill" /><span>Verified Creator badge on your profile</span></div>
          <div className={styles.perkRow}><i className="ri-rocket-2-fill" /><span>Priority tournament hosting perks</span></div>
          <div className={styles.perkRow}><i className="ri-group-fill" /><span>Reach thousands of Tanzanian gamers</span></div>
          <div className={styles.perkRow}><i className="ri-line-chart-fill" /><span>Your own creator dashboard &amp; stats</span></div>
        </div>

        {applied ? (
          <div className={styles.pendingCard}>
            <i className="ri-time-line" />
            <span>Application submitted — pending review. We'll notify you once approved.</span>
          </div>
        ) : (
          <button className={styles.primaryBtn} disabled={applying} onClick={handleApply}>
            {applying ? 'Submitting…' : 'Apply for Creators Hub'}
          </button>
        )}
      </div>
    )
  }

  const activeCount = myTournaments.filter(t => t.status === 'active').length

  return (
    <div className={styles.page}>
      <div className={styles.dashHeader}>
        <div className={styles.dashBadge}><i className="ri-shield-star-fill" /></div>
        <div>
          <h1 className={styles.dashTitle}>Creators Hub</h1>
          <p className={styles.dashSub}>Welcome back, {profile.username}.</p>
        </div>
      </div>

      <div className={styles.encourageCard}>
        <i className="ri-fire-fill" />
        <p>
          {myTournaments.length === 0
            ? "You're approved — your first tournament is one tap away. Every big community on Nabogaming started with one host who just went for it. That's you now."
            : `You've hosted ${myTournaments.length} tournament${myTournaments.length === 1 ? '' : 's'} and pulled in ${participantCount} player${participantCount === 1 ? '' : 's'}. Keep the momentum — post about your next one in the feed a day before it starts.`
          }
        </p>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statBox}>
          <span className={styles.statVal}>{myTournaments.length}</span>
          <span className={styles.statLabel}>Hosted</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statVal}>{activeCount}</span>
          <span className={styles.statLabel}>Active Now</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statVal}>{participantCount}</span>
          <span className={styles.statLabel}>Total Players</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statVal} style={{ fontSize: earningsTotal >= 100000 ? 13 : undefined }}>
            {earningsTotal > 0 ? fmtAmt(earningsTotal) : '—'}
          </span>
          <span className={styles.statLabel}>Earnings</span>
        </div>
      </div>

      <Link href="/wallet" className={styles.upgradeCard}>
        <div className={styles.upgradeIcon}><i className="ri-money-dollar-circle-fill" /></div>
        <div className={styles.upgradeMeta}>
          <span className={styles.upgradeTitle}>{earningsTotal > 0 ? `Earned ${fmtAmt(earningsTotal)} so far` : 'No earnings yet'}</span>
          <span className={styles.upgradeSub}>Prize money, bonuses &amp; payouts recorded on Nabogaming. See the full breakdown in your Wallet.</span>
        </div>
        <i className="ri-arrow-right-s-line" />
      </Link>

      <Link href="/tournaments/create" className={styles.createBtn}>
        <i className="ri-add-circle-fill" /> Create New Tournament
      </Link>

      {!hasCreatorPerks && (
        <Link href="/upgrade" className={styles.upgradeCard}>
          <div className={styles.upgradeIcon}><i className="ri-vip-diamond-fill" /></div>
          <div className={styles.upgradeMeta}>
            <span className={styles.upgradeTitle}>Unlock the full Creator toolkit</span>
            <span className={styles.upgradeSub}>Elite gets you a verified badge, analytics on your tournaments, and a Partner dashboard — from just TZS 1,000.</span>
          </div>
          <i className="ri-arrow-right-s-line" />
        </Link>
      )}

      <h3 className={styles.sectionTitle}>Hosting Activity</h3>
      {myTournaments.length === 0 ? (
        <div className={styles.chartCard}>
          <p className={styles.chartEmpty}>Your player-count graph shows up here once you've hosted a few tournaments.</p>
        </div>
      ) : (
        <div className={styles.chartCard}>
          <div className={styles.chartHeaderRow}>
            <span className={styles.chartHeaderTitle}>Players per tournament</span>
            <span className={styles.chartHeaderSub}>last {Math.min(myTournaments.length, 6)}</span>
          </div>
          <div className={styles.chartBars}>
            {[...myTournaments].slice(0, 6).reverse().map(t => {
              const val = t.registered_count || 0
              const max = Math.max(1, ...myTournaments.slice(0, 6).map(x => x.registered_count || 0))
              const pct = Math.max(4, Math.round((val / max) * 100))
              return (
                <div key={t.id} className={styles.chartBarCol}>
                  <div className={styles.chartBarWrap}>
                    <div className={styles.chartBar} style={{ height: `${pct}%` }} title={`${t.name}: ${val} players`} />
                  </div>
                  <span className={styles.chartBarLabel}>{val}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <h3 className={styles.sectionTitle}>Hosting Tips</h3>
      <div className={styles.tipsCard}>
        <div className={styles.tipRow}><i className="ri-megaphone-fill" /><span>Post your tournament in the feed 24h before it starts — early buzz fills slots faster.</span></div>
        <div className={styles.tipRow}><i className="ri-timer-flash-fill" /><span>Respond to score disputes quickly — fast resolutions keep players coming back.</span></div>
        <div className={styles.tipRow}><i className="ri-price-tag-3-fill" /><span>Clear entry fees and rules upfront build trust and reduce no-shows.</span></div>
      </div>

      <h3 className={styles.sectionTitle}>Your Tournaments</h3>

      {loadingTournaments ? (
        <p className={styles.empty}>Loading…</p>
      ) : myTournaments.length === 0 ? (
        <p className={styles.empty}>You haven't created a tournament yet.</p>
      ) : (
        <div className={styles.list}>
          {myTournaments.map(t => {
            const game = GAME_META[t.game_slug]
            const fillPct = t.slots ? Math.min(100, Math.round(((t.registered_count || 0) / t.slots) * 100)) : 0
            return (
              <Link key={t.id} href={`/tournaments/${t.id}/manage`} className={styles.row}>
                <div className={styles.rowIcon}>
                  {game?.image ? <img src={game.image} alt={game.name} /> : <i className="ri-trophy-line" />}
                </div>
                <div className={styles.rowMeta}>
                  <span className={styles.rowName}>{t.name}</span>
                  <span className={styles.rowSub}>{game?.name || t.game_slug} · {t.status}{t.slots ? ` · ${t.registered_count || 0}/${t.slots}` : ''}</span>
                  {t.slots > 0 && (
                    <div className={styles.rowFillTrack}>
                      <div className={styles.rowFillBar} style={{ width: `${fillPct}%` }} />
                    </div>
                  )}
                </div>
                <i className="ri-arrow-right-s-line" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
