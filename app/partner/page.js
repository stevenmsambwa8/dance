'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { useCurrency } from '../../lib/currency'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'

function StatCard({ icon, label, value, color }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statIcon} style={{ color, background: color + '22' }}>
        <i className={icon} />
      </div>
      <div>
        <div className={styles.statVal}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </div>
  )
}

export default function PartnerPage() {
  const router = useRouter()
  const { user, profile, loading: authLoading } = useAuth()
  const isPartner = profile?.tier === 'Partner'
  const { fmtAmt } = useCurrency(profile?.country_flag)

  const [stats, setStats]           = useState(null)
  const [topMatches, setTopMatches] = useState([])
  const [earnings, setEarnings]     = useState([])
  const [partners, setPartners]     = useState([])
  const [loading, setLoading]       = useState(true)
  usePageLoading(authLoading || loading)

  // Redirect non-partners once auth settles
  useEffect(() => {
    if (!authLoading && (!user || !isPartner)) {
      router.replace('/')
    }
  }, [authLoading, user, isPartner])

  useEffect(() => {
    if (user && isPartner) load()
  }, [user, isPartner])

  async function load() {
    setLoading(true)
    const [
      { data: profileData },
      { data: matchData },
      { data: earningsData },
      { data: partnerList },
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('wins, losses, points, season_wins, season_losses, level, tier, username')
        .eq('id', user.id)
        .single(),
      supabase
        .from('matches')
        .select('id, slug, game_mode, status, score_challenger, score_challenged, winner_id, challenger_id, challenged_id, scheduled_at, challenger:profiles!matches_challenger_id_fkey(username, tier, level), challenged:profiles!matches_challenged_id_fkey(username, tier, level)')
        .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(8),
      supabase
        .from('earnings_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('profiles')
        .select('id, username, level, avatar_url, wins, points, country_flag')
        .eq('tier', 'Partner')
        .order('points', { ascending: false })
        .limit(12),
    ])
    setStats(profileData)
    setTopMatches(matchData || [])
    setEarnings(earningsData || [])
    setPartners(partnerList || [])
    setLoading(false)
  }

  if (authLoading || loading) return null
  if (!user || !isPartner) return null

  const winRate = stats
    ? stats.wins + stats.losses > 0
      ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
      : 0
    : 0

  function getOpponent(match) {
    return match.challenger_id === user.id ? match.challenged : match.challenger
  }

  function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className={styles.page}>
      {/* ── Hero banner ── */}
      <div className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroBadge}>
          <i className="ri-shield-star-fill" /> PARTNER
        </div>
        <h1 className={styles.heroTitle}>Partner Hub</h1>
        <p className={styles.heroSub}>
          Exclusive access for top-tier players. Welcome back, <strong>{profile?.username}</strong>.
        </p>
      </div>

      {/* ── Stats row ── */}
      <div className={styles.statsRow}>
        <StatCard icon="ri-trophy-line"      label="Total Wins"     value={stats?.wins ?? 0}          color="#22c55e" />
        <StatCard icon="ri-line-chart-line"  label="Win Rate"       value={`${winRate}%`}              color="#06b6d4" />
        <StatCard icon="ri-star-line"        label="Season Wins"    value={stats?.season_wins ?? 0}    color="#a78bfa" />
        <StatCard icon="ri-coins-line"       label="Total Points"   value={(stats?.points ?? 0).toLocaleString()} color="#f59e0b" />
      </div>

      {/* ── Partner perks ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-vip-crown-line" /> Partner Perks</h2>
        <div className={styles.perksGrid}>
          {[
            { icon: 'ri-vip-crown-fill',       color: '#f59e0b', title: 'Priority Matchmaking',    desc: 'Get matched first in any queue. No waiting in line.' },
            { icon: 'ri-shield-star-fill',      color: '#22c55e', title: 'Partner Badge',           desc: 'Animated green ring and Partner chip visible to all players.' },
            { icon: 'ri-eye-line',              color: '#06b6d4', title: 'Partner Hub Access',      desc: 'This page — stats, insights, and the Partner network.' },
            { icon: 'ri-bar-chart-2-line',      color: '#a78bfa', title: 'Deep Stats',              desc: 'Full win-rate history, earnings breakdown, and match logs.' },
            { icon: 'ri-group-line',            color: '#ef4444', title: 'Partner Network',         desc: 'See all other Partner-tier players and challenge them directly.' },
            { icon: 'ri-lock-unlock-line',      color: '#38bdf8', title: 'No Loss Drop',            desc: 'Partners keep their tier even in a rough season.' },
          ].map(p => (
            <div key={p.title} className={styles.perkCard}>
              <div className={styles.perkIcon} style={{ color: p.color, background: p.color + '20' }}>
                <i className={p.icon} />
              </div>
              <div>
                <div className={styles.perkTitle}>{p.title}</div>
                <div className={styles.perkDesc}>{p.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Recent Matches ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-swords-line" /> Recent Matches</h2>
          <Link href="/matches" className={styles.sectionLink}>All matches <i className="ri-arrow-right-s-line" /></Link>
        </div>
        {topMatches.length === 0 ? (
          <p className={styles.empty}>No completed matches yet.</p>
        ) : (
          <div className={styles.matchList}>
            {topMatches.map(m => {
              const opp     = getOpponent(m)
              const isWin   = m.winner_id === user.id
              const isMine  = m.challenger_id === user.id
              const myScore = isMine ? m.score_challenger : m.score_challenged
              const oppScore= isMine ? m.score_challenged : m.score_challenger
              return (
                <Link key={m.id} href={`/matches/${m.slug || m.id}`} className={styles.matchRow}>
                  <span className={`${styles.matchResult} ${isWin ? styles.win : styles.loss}`}>
                    {isWin ? 'W' : 'L'}
                  </span>
                  <div className={styles.matchInfo}>
                    <span className={styles.matchOpp}>{opp?.username || '—'}</span>
                    <span className={styles.matchGame}>{m.game_mode}</span>
                  </div>
                  <span className={styles.matchScore}>
                    {myScore ?? '—'} – {oppScore ?? '—'}
                  </span>
                  <span className={styles.matchDate}>{fmtDate(m.scheduled_at)}</span>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Earnings Log ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-wallet-3-line" /> Recent Earnings</h2>
          <Link href="/wallet" className={styles.sectionLink}>Full wallet <i className="ri-arrow-right-s-line" /></Link>
        </div>
        {earnings.length === 0 ? (
          <p className={styles.empty}>No earnings logged yet.</p>
        ) : (
          <div className={styles.earningsList}>
            {earnings.map((e, i) => {
              const isPrize = e.type === 'prize'
              return (
                <div key={e.id || i} className={styles.earningRow}>
                  <div className={styles.earningIcon} style={{ color: isPrize ? '#f59e0b' : '#22c55e', background: isPrize ? '#f59e0b22' : '#22c55e22' }}>
                    <i className={isPrize ? 'ri-money-dollar-circle-line' : 'ri-add-line'} />
                  </div>
                  <div className={styles.earningInfo}>
                    <span className={styles.earningLabel}>{e.type?.replace(/_/g, ' ') || 'Activity'}</span>
                    {e.description && <span className={styles.earningDesc}>{e.description}</span>}
                  </div>
                  <span className={styles.earningVal} style={{ color: isPrize ? '#f59e0b' : '#22c55e' }}>
                    {isPrize ? fmtAmt(e.points) : `+${e.points ?? 0} pts`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Partner Network ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-group-line" /> Partner Network</h2>
        <p className={styles.networkSub}>All players who have reached Partner tier.</p>
        <div className={styles.networkGrid}>
          {partners.map(p => (
            <Link key={p.id} href={`/profile/${p.id}`} className={`${styles.networkCard} ${p.id === user.id ? styles.networkCardSelf : ''}`}>
              <div className={styles.networkAvatar}>
                {p.avatar_url
                  ? <img src={p.avatar_url} alt="" />
                  : <span>{(p.username || 'P').slice(0, 2).toUpperCase()}</span>
                }
                {p.id === user.id && <span className={styles.youBadge}>You</span>}
              </div>
              <div className={styles.networkName}>{p.username}</div>
              <div className={styles.networkStats}>
                <span><i className="ri-trophy-line" /> {p.wins ?? 0}</span>
                <span><i className="ri-coins-line" /> {(p.points ?? 0).toLocaleString()}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
