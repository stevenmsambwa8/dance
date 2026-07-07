'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import { GAME_META } from '../../lib/constants'
import { getActivePlan } from '../../lib/plans'
import styles from './page.module.css'

/**
 * Creators Hub — gated by profiles.is_creator.
 *   - Not logged in  → auth gate.
 *   - Logged in, not yet a creator → application pitch + apply button.
 *     Applying sets creator_applied_at (persists across reloads) and
 *     notifies admins; approval itself is manual (toggle is_creator in
 *     Supabase) — there's no self-serve auto-approve path here on purpose.
 *   - Logged in, is_creator → dashboard: create-tournament shortcut + list
 *     of tournaments they've created (tournaments.created_by = user.id).
 */
export default function CreatorsHubPage() {
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [myTournaments, setMyTournaments] = useState([])
  const [loadingTournaments, setLoadingTournaments] = useState(false)
  const [participantCount, setParticipantCount] = useState(0)

  const activePlan = getActivePlan(profile)
  const hasCreatorPerks = activePlan === 'elite' || activePlan === 'team'

  useEffect(() => {
    if (!user || !profile?.is_creator) return
    setLoadingTournaments(true)
    supabase
      .from('tournaments')
      .select('id, name, game_slug, status, entrance_fee, created_at')
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
  }, [user, profile?.is_creator])

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

  if (!profile?.is_creator) {
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
      </div>

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
          {myTournaments.map(t => (
            <Link key={t.id} href={`/tournaments/${t.id}/manage`} className={styles.row}>
              <div className={styles.rowIcon}><i className="ri-trophy-line" /></div>
              <div className={styles.rowMeta}>
                <span className={styles.rowName}>{t.name}</span>
                <span className={styles.rowSub}>{GAME_META[t.game_slug]?.name || t.game_slug} · {t.status}</span>
              </div>
              <i className="ri-arrow-right-s-line" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
