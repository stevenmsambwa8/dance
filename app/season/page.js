'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { getCurrentSeason, getDaysRemaining, TIER_ORDER, TIER_WIN_THRESHOLD, getLevelWinThreshold, MAX_LEVEL } from '../../lib/seasons'
import UserBadges from '../../components/UserBadges'
import usePageLoading from '../../components/usePageLoading'
import styles from './page.module.css'

const TIER_COLORS = {
  Bronze:   '#cd7f32',
  Silver:   '#94a3b8',
  Gold:     '#f59e0b',
  Platinum: '#60a5fa',
  Diamond:  '#a78bfa',
  Legend:   '#f43f5e',
}

function fmtTZS(n) {
  return `TZS ${Number(n).toLocaleString('en-TZ')}`
}

function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const EVENT_META = {
  match_win:            { label: 'Match Win',       icon: 'ri-sword-fill',               color: '#22c55e' },
  match_loss:           { label: 'Match Loss',      icon: 'ri-sword-line',               color: '#64748b' },
  tournament_win:       { label: 'Round Win',       icon: 'ri-trophy-fill',              color: '#60a5fa' },
  tournament_advance:   { label: 'Advanced',        icon: 'ri-arrow-right-up-line',      color: '#60a5fa' },
  tournament_eliminate: { label: 'Eliminated',      icon: 'ri-close-circle-line',        color: '#64748b' },
  tournament_champion:  { label: 'Champion',        icon: 'ri-vip-crown-fill',           color: '#f59e0b' },
  tournament_podium:    { label: 'Podium',          icon: 'ri-medal-fill',               color: '#a78bfa' },
  prize:                { label: 'Prize Awarded',   icon: 'ri-money-dollar-circle-fill', color: '#f59e0b' },
  shop_payout:          { label: 'Shop Sale',       icon: 'ri-store-2-line',             color: '#34d399' },
}

function evMeta(type) {
  return EVENT_META[type] || { label: type || 'Event', icon: 'ri-history-line', color: '#64748b' }
}

function getEncouragement(seasonWins, seasonLosses) {
  const total = seasonWins + seasonLosses
  const winRate = total > 0 ? Math.round((seasonWins / total) * 100) : 0

  if (total === 0) return { msg: "Your season starts now. Every legend began with zero wins.", icon: 'ri-rocket-line', color: '#60a5fa' }
  if (seasonWins === 0 && seasonLosses > 0) return { msg: "Every loss is a lesson. The best players fall before they fly — keep grinding.", icon: 'ri-fire-line', color: '#f59e0b' }
  if (winRate >= 70) return { msg: `${winRate}% win rate — you're dominating this season. Keep that energy up.`, icon: 'ri-vip-crown-fill', color: '#f59e0b' }
  if (winRate >= 50) return { msg: `Solid ${winRate}% win rate. You're above average — push harder and climb.`, icon: 'ri-bar-chart-fill', color: '#22c55e' }
  if (seasonLosses > seasonWins && total >= 5) return { msg: "Losses build champions. Every player you face is making you sharper. Don't stop.", icon: 'ri-shield-flash-fill', color: '#a78bfa' }
  if (seasonWins >= 10) return { msg: `${seasonWins} wins this season already. You're building something real.`, icon: 'ri-sword-fill', color: '#22c55e' }
  return { msg: "Stay consistent. Small wins stack into big results. Keep showing up.", icon: 'ri-heart-fill', color: '#f43f5e' }
}

export default function SeasonPage() {
  const { user, profile } = useAuth()
  const [logs, setLogs] = useState([])
  const [tourneyEntries, setTourneyEntries] = useState([])
  const [seasonHistory, setSeasonHistory] = useState([])
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)

  const season = getCurrentSeason()
  const daysLeft = getDaysRemaining()
  const seasonProgress = Math.max(4, 100 - Math.round((daysLeft / 90) * 100))

  useEffect(() => {
    if (user) load()
    else setLoading(false)
  }, [user])

  async function load() {
    setLoading(true)
    const [logsRes, tournRes, histRes] = await Promise.all([
      supabase.from('earnings_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('tournament_leaderboard')
        .select('*, tournaments(name, id, slug)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('season_history')
        .select('*')
        .eq('user_id', user.id)
        .order('season_number', { ascending: false })
        .limit(10),
    ])
    setLogs(logsRes.data || [])
    setTourneyEntries(tournRes.data || [])
    setSeasonHistory(histRes.data || [])
    setLoading(false)
  }

  if (!user) return (
    <div className={styles.page}>
      <div className={styles.guestWrap}>
        <i className="ri-shield-star-line" style={{ fontSize: 48, color: 'var(--accent, #f59e0b)' }} />
        <h2>Track Your Season</h2>
        <p>Sign in to see your level progression, tier climbs, and full season history.</p>
        <Link href="/login" className={styles.ctaBtn}>Sign In</Link>
      </div>
    </div>
  )

  const tier = profile?.tier || 'Gold'
  const level = profile?.level ?? 1
  const seasonWins = profile?.season_wins ?? 0
  const seasonLosses = profile?.season_losses ?? 0
  const totalWins = profile?.wins ?? 0
  const totalLosses = profile?.losses ?? 0
  const tierColor = TIER_COLORS[tier] || '#f59e0b'
  const tierIdx = TIER_ORDER.indexOf(tier)
  const isMaxTier = tierIdx === TIER_ORDER.length - 1
  const nextTier = isMaxTier ? null : TIER_ORDER[tierIdx + 1]
  const tierThreshold = TIER_WIN_THRESHOLD[tier] || 50
  const tierPct = Math.min(100, Math.round((seasonWins / tierThreshold) * 100))
  const levelThreshold = getLevelWinThreshold(level)
  const isMaxLevel = level >= MAX_LEVEL
  const levelPct = isMaxLevel ? 100 : Math.min(100, Math.max(0, Math.round((seasonWins / levelThreshold) * 100)))
  const winRate = totalWins + totalLosses > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0

  // Points breakdown
  const matchPts   = logs.filter(l => l.type?.startsWith('match')).reduce((s, l) => s + (l.points ?? 0), 0)
  const tourneyPts = logs.filter(l => l.type?.startsWith('tournament')).reduce((s, l) => s + (l.points ?? 0), 0)
  const prizeTZS   = logs.filter(l => l.type === 'prize').reduce((s, l) => s + (l.points ?? 0), 0)

  const encouragement = getEncouragement(seasonWins, seasonLosses)

  const timeline = [...logs.map(l => ({ ...l, _date: l.created_at }))]
    .sort((a, b) => new Date(b._date) - new Date(a._date))
    .slice(0, 40)

  return (
    <div className={styles.page}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.headerLeft}>
            <span className={styles.eyebrow}><i className="ri-calendar-line" /> Season {season}</span>
            <h1 className={styles.title}>
              {profile?.username || 'Player'}
              <UserBadges email={profile?.email} countryFlag={profile?.country_flag} isSeasonWinner={profile?.is_season_winner} size={16} gap={4} />
            </h1>
          </div>
          <div className={styles.tierBadge} style={{ '--tier-color': tierColor }}>
            <span className={styles.tierLabel}>{tier}</span>
            <span className={styles.tierLevel}>Lv.{level}</span>
          </div>
        </div>

        {/* Season time bar */}
        <div className={styles.seasonBarWrap}>
          <div className={styles.seasonBarMeta}>
            <span>Season {season} progress</span>
            <span>{daysLeft} days left</span>
          </div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${seasonProgress}%`, background: 'var(--accent, #f59e0b)' }} />
          </div>
        </div>
      </div>

      {/* ── Encouragement banner ── */}
      <div className={styles.encourageBanner} style={{ '--enc-color': encouragement.color }}>
        <i className={encouragement.icon} style={{ color: encouragement.color, fontSize: 20, flexShrink: 0 }} />
        <p className={styles.encourageMsg}>{encouragement.msg}</p>
      </div>

      {/* ── Stats strip ── */}
      <div className={styles.statsStrip}>
        {[
          { icon: 'ri-sword-fill',        color: '#22c55e', val: seasonWins,     label: 'Season Wins' },
          { icon: 'ri-close-circle-line', color: '#64748b', val: seasonLosses,   label: 'Losses' },
          { icon: 'ri-percent-line',      color: '#60a5fa', val: `${winRate}%`,  label: 'Win Rate' },
          { icon: 'ri-coins-line',        color: '#f59e0b', val: (profile?.points ?? 0).toLocaleString(), label: 'Total Pts' },
        ].map(s => (
          <div key={s.label} className={styles.statCard}>
            <i className={s.icon} style={{ color: s.color }} />
            <span className={styles.statVal}>{s.val}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Level + Tier progress ── */}
      <div className={styles.progressSection}>

        {/* Level */}
        <div className={styles.progressCard}>
          <div className={styles.progressCardHeader}>
            <div>
              <span className={styles.progressCardTitle}><i className="ri-bar-chart-fill" /> Level Progress</span>
              <span className={styles.progressCardSub}>
                {isMaxLevel ? 'MAX LEVEL REACHED' : `Lv.${level} → Lv.${level + 1}`}
              </span>
            </div>
            <span className={styles.progressBig} style={{ color: '#60a5fa' }}>Lv.{level}</span>
          </div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${levelPct}%`, background: 'linear-gradient(90deg, #3b82f6, #60a5fa)' }} />
          </div>
          <div className={styles.progressMeta}>
            <span>{seasonWins} wins this season</span>
            {!isMaxLevel
              ? <span>{Math.max(0, levelThreshold - seasonWins)} more to level up</span>
              : <span>🔥 Maxed out</span>}
          </div>
          {!isMaxLevel && seasonLosses > 0 && (
            <p className={styles.progressHint}>
              <i className="ri-information-line" /> Losses don't hold you back — only wins count toward level.
            </p>
          )}
        </div>

        {/* Tier */}
        <div className={styles.progressCard}>
          <div className={styles.progressCardHeader}>
            <div>
              <span className={styles.progressCardTitle}><i className="ri-shield-star-fill" /> Tier Progress</span>
              <span className={styles.progressCardSub}>
                {isMaxTier ? 'LEGEND — HIGHEST TIER' : `${tier} → ${nextTier}`}
              </span>
            </div>
            <span className={styles.progressBig} style={{ color: tierColor }}>{tier}</span>
          </div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${isMaxTier ? 100 : tierPct}%`, background: `linear-gradient(90deg, ${tierColor}99, ${tierColor})` }} />
          </div>
          <div className={styles.progressMeta}>
            <span>{seasonWins} / {tierThreshold} wins</span>
            {!isMaxTier
              ? <span>{Math.max(0, tierThreshold - seasonWins)} wins to {nextTier}</span>
              : <span>👑 Elite</span>}
          </div>

          {/* Tier dots */}
          <div className={styles.tierRow}>
            {TIER_ORDER.map((t, i) => (
              <div key={t} className={`${styles.tierDot} ${t === tier ? styles.tierDotActive : ''} ${i < tierIdx ? styles.tierDotDone : ''}`}
                style={{ '--dot-color': TIER_COLORS[t] }}>
                <span className={styles.tierDotLabel}>{t.slice(0, 2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Points breakdown ── */}
      <div className={styles.pointsSection}>
        <h2 className={styles.sectionTitle}><i className="ri-coins-line" /> Earnings Breakdown</h2>
        <div className={styles.pointsGrid}>
          <div className={styles.pointsCard}>
            <i className="ri-sword-fill" style={{ color: '#22c55e', fontSize: 20 }} />
            <span className={styles.pointsVal} style={{ color: '#22c55e' }}>{matchPts.toLocaleString()}</span>
            <span className={styles.pointsLabel}>Match pts</span>
          </div>
          <div className={styles.pointsCard}>
            <i className="ri-trophy-fill" style={{ color: '#60a5fa', fontSize: 20 }} />
            <span className={styles.pointsVal} style={{ color: '#60a5fa' }}>{tourneyPts.toLocaleString()}</span>
            <span className={styles.pointsLabel}>Tournament pts</span>
          </div>
          <div className={styles.pointsCard} style={{ gridColumn: 'span 2' }}>
            <i className="ri-money-dollar-circle-fill" style={{ color: '#f59e0b', fontSize: 20 }} />
            <span className={styles.pointsVal} style={{ color: '#f59e0b', fontSize: prizeTZS >= 10000 ? 15 : 20 }}>
              {prizeTZS > 0 ? fmtTZS(prizeTZS) : '—'}
            </span>
            <span className={styles.pointsLabel}>Prize money earned</span>
          </div>
        </div>
      </div>

      {/* ── Tournament results ── */}
      {tourneyEntries.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}><i className="ri-node-tree" /> Tournament Results</h2>
          <div className={styles.tourneyList}>
            {tourneyEntries.map((e, i) => {
              const pos = e.position
              const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos ? `#${pos}` : '—'
              const isElim = !pos || pos > 3
              return (
                <Link key={e.id || i} href={`/tournaments/${e.tournaments?.id || ''}`} className={styles.tourneyRow}>
                  <span className={styles.tourneyMedal}>{medal}</span>
                  <div className={styles.tourneyInfo}>
                    <span className={styles.tourneyName}>{e.tournaments?.name || 'Tournament'}</span>
                    <span className={styles.tourneyMeta} style={{ color: isElim ? '#64748b' : undefined }}>
                      {isElim ? 'Every tournament sharpens your game' : `Position ${pos}`}
                    </span>
                  </div>
                  <span className={styles.tourneyPts}>
                    {e.points > 0 ? `+${e.points} pts` : '—'}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Activity Timeline ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-history-line" /> Activity</h2>
          <Link href="/wallet" className={styles.sectionLink}>Full wallet <i className="ri-arrow-right-s-line" /></Link>
        </div>
        {loading ? (
          <div className={styles.skeletonList}>
            {[...Array(5)].map((_, i) => <div key={i} className={styles.skeletonRow} />)}
          </div>
        ) : timeline.length === 0 ? (
          <div className={styles.empty}>
            <i className="ri-inbox-2-line" />
            <p>No activity yet — go play!</p>
          </div>
        ) : (
          <div className={styles.timeline}>
            {timeline.map((ev, i) => {
              const meta = evMeta(ev.type)
              const pts = ev.points ?? 0
              const isPrize = ev.type === 'prize'
              const isLoss = ev.type === 'match_loss' || ev.type === 'tournament_eliminate'
              return (
                <div key={ev.id || i} className={styles.timelineRow}>
                  <div className={styles.timelineDotWrap}>
                    <div className={styles.timelineDot} style={{ background: meta.color }} />
                    {i < timeline.length - 1 && <div className={styles.timelineLine} />}
                  </div>
                  <div className={styles.timelineContent}>
                    <div className={styles.timelineTop}>
                      <span className={styles.timelineIcon} style={{ color: meta.color, background: meta.color + '18' }}>
                        <i className={meta.icon} />
                      </span>
                      <span className={styles.timelineLabel}>{meta.label}</span>
                      {isPrize && pts > 0 ? (
                        <span className={styles.timelinePts} style={{ color: '#f59e0b' }}>{fmtTZS(pts)}</span>
                      ) : !isPrize && pts !== 0 ? (
                        <span className={styles.timelinePts} style={{ color: pts > 0 ? '#22c55e' : '#64748b' }}>
                          {pts > 0 ? `+${pts}` : pts} pts
                        </span>
                      ) : null}
                    </div>
                    {ev.description && <p className={styles.timelineDesc}>{ev.description}</p>}
                    {isLoss && (
                      <p className={styles.timelineEncourage}>
                        <i className="ri-fire-line" /> You still earned {Math.abs(pts)} pts — every match counts.
                      </p>
                    )}
                    <span className={styles.timelineTime}>{timeAgo(ev._date)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Season History ── */}
      {seasonHistory.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}><i className="ri-archive-line" /> Past Seasons</h2>
          <div className={styles.historyList}>
            {seasonHistory.map(h => (
              <div key={h.id || h.season_number} className={styles.historyRow}>
                <div className={styles.historyMeta}>
                  <span className={styles.historySeason}>Season {h.season_number}</span>
                  <span className={styles.historyTier} style={{ color: TIER_COLORS[h.tier] || '#94a3b8' }}>{h.tier}</span>
                </div>
                <div className={styles.historyStats}>
                  <span><i className="ri-sword-fill" style={{ color: '#22c55e' }} /> {h.wins}W</span>
                  <span><i className="ri-close-circle-line" style={{ color: '#64748b' }} /> {h.losses}L</span>
                  <span><i className="ri-coins-line" style={{ color: '#f59e0b' }} /> {(h.points || 0).toLocaleString()} pts</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
