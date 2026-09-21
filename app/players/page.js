'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, isHelpdeskEmail } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'
import { getCurrentSeason } from '../../lib/seasons'
import UserBadges from '../../components/UserBadges'
import { useOnlineUsers } from '../../lib/usePresence'
import { presenceLabel } from '../../lib/lastSeen'
import { RANK_META } from '../../lib/constants'

/* ── Daily Spotlight Cards ───────────────────────────────── */
function SpotlightCards({ players, onlineIds, onNavigate }) {
  const scrollRef = useRef(null)

  // Pick 3 deterministic random users per calendar day
  const featured = useMemo(() => {
    if (!players.length) return []
    const today   = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const seed    = today.split('-').reduce((a, b) => a + Number(b), 0)
    const pool    = players.filter(p => !isHelpdeskEmail(p.email))
    const shuffled = [...pool].sort((a, b) => {
      const ha = ((seed ^ a.id.charCodeAt?.(0) ?? 0) * 2654435761) >>> 0
      const hb = ((seed ^ b.id.charCodeAt?.(0) ?? 0) * 2654435761) >>> 0
      return ha - hb
    })
    return shuffled.slice(0, 3)
  }, [players])

  if (!featured.length) return null

  return (
    <div className={styles.spotlightWrap}>
      <p className={styles.spotlightLabel}>
        <i className="ri-sparkling-line"/> Daily Spotlight
      </p>
      <div ref={scrollRef} className={styles.spotlightScroll}>
        {featured.map(p => {
          const rank   = RANK_META[p.tier] || RANK_META.Gold
          const online = onlineIds.has(p.id)
          const wr     = p.wins && p.total_matches
            ? Math.round((p.wins / p.total_matches) * 100) : null
          return (
            <div key={p.id} className={styles.spotlightCard}
              onClick={() => onNavigate(`/profile/${p.id}`)}>
              {/* Avatar */}
              <div className={styles.spAvatarWrap}>
                <div className={styles.spAvatar}>
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt=""/>
                    : <span>{(p.username || '?').slice(0, 2).toUpperCase()}</span>
                  }
                </div>
                <span className={styles.spOnline}
                  style={{ background: online ? '#22c55e' : 'var(--border-dark)' }}/>
              </div>
              {/* Info */}
              <div className={styles.spName}>
                {(p.username || '?').length > 12
                  ? (p.username || '?').slice(0, 12) + '…'
                  : (p.username || '?')}
                <UserBadges
                  email={p.email} plan={p.plan} planExpiresAt={p.plan_expires_at}
                  countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner} customBadges={p.custom_badges} tempAdminUntil={p.temp_admin_until}
                  size={11} gap={2}/>
              </div>
              <div className={styles.spMeta} style={{ color: rank.color }}>{p.tier}</div>
              <div className={styles.spStats}>
                <span>{p.wins ?? 0}W</span>
                {wr !== null && <span>{wr}%</span>}
                <span>Lv.{p.level ?? 1}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────── */
export default function PlayersPage() {
  const { user, profile } = useAuth()
  const { openAuthGate }  = useAuthGate()
  const router            = useRouter()
  const [players, setPlayers]           = useState([])
  const [following, setFollowing]       = useState({})
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  usePageLoading(loading)
  const onlineIds = useOnlineUsers()

  useEffect(() => { loadPlayers() }, [])

  useEffect(() => {
    if (!user || !players.length) return
    supabase.from('follows').select('following_id').eq('follower_id', user.id)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(f => { map[f.following_id] = true })
        setFollowing(map)
      })
  }, [user, players.length])

  // Load EVERY player (no cap). Supabase returns at most 1000 rows per request,
  // so page through in batches until a short batch comes back.
  async function loadPlayers() {
    setLoading(true)
    const BATCH = 1000
    let all = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('level', { ascending: false })
        .order('wins',  { ascending: false })
        .order('id',    { ascending: true })   // stable tie-break so batches never overlap
        .range(from, from + BATCH - 1)
      if (error || !data) break
      all = all.concat(data)
      if (data.length < BATCH) break
      from += BATCH
    }
    setPlayers(all)
    setLoading(false)
  }

  async function toggleFollow(e, playerId) {
    e.stopPropagation()
    if (!user) { openAuthGate(); return }
    const isF = following[playerId]
    setFollowing(f => ({ ...f, [playerId]: !isF }))
    if (isF) {
      await supabase.from('follows').delete()
        .eq('follower_id', user.id).eq('following_id', playerId)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: playerId })
    }
  }

  // Level/wins rank (order the players were loaded in) — stays meaningful even
  // though the list itself is sorted by activity.
  const rankById = useMemo(() => {
    const m = {}
    players.forEach((p, i) => { m[p.id] = i + 1 })
    return m
  }, [players])

  // Online first (keeping level/wins order), then most recently seen, never-seen last.
  const sortedPlayers = useMemo(() => {
    const seen = p => (p.last_seen ? new Date(p.last_seen).getTime() || 0 : 0)
    return [...players].sort((a, b) => {
      const ao = onlineIds.has(a.id)
      const bo = onlineIds.has(b.id)
      if (ao !== bo) return ao ? -1 : 1
      if (ao && bo) return 0
      return seen(b) - seen(a)
    })
  }, [players, onlineIds])

  const filtered = sortedPlayers.filter(p =>
    !search || p.username?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Season {getCurrentSeason()} · PlayWithFriends</p>
          <h1 className={styles.headline}>PLAYERS</h1>
        </div>
      </div>

      {/* Spotlight cards — only shown before search */}
      {!search && (
        <SpotlightCards
          players={players}
          onlineIds={onlineIds}
          onNavigate={router.push.bind(router)}
        />
      )}

      {/* Search */}
      <div className={styles.searchWrap}>
        <i className="ri-search-line"/>
        <input className={styles.searchInput} placeholder="Search players…"
          value={search} onChange={e => setSearch(e.target.value)}/>
        {search && (
          <button onClick={() => setSearch('')}
            style={{ background:'none', border:'none', color:'var(--text-muted)',
                     cursor:'pointer', padding:0, fontSize:16, lineHeight:1 }}>
            <i className="ri-close-line"/>
          </button>
        )}
      </div>

      {/* Stats strip */}
      <div className={styles.statsStrip}>
        <span><i className="ri-group-line"/> {players.length} players</span>
        <span>·</span>
        <span style={{ color:'#22c55e' }}>
          <i className="ri-radio-button-line"/> {onlineIds.size} online
        </span>
      </div>

      {/* Skeleton */}
      {loading && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {[...Array(7)].map((_, i) => (
            <div key={i} style={{
              height:64, borderRadius:14,
              background:'var(--surface)', border:'1px solid var(--border)',
              opacity: 1 - i * 0.1,
            }}/>
          ))}
        </div>
      )}

      {/* List */}
      {!loading && (
        <div className={styles.list}>
          {filtered.map(p => {
            const rankMeta  = RANK_META[p.tier] || RANK_META.Gold
            const isOnline  = onlineIds.has(p.id)
            const isSupport = isHelpdeskEmail(p.email)
            const isPartner = p.tier === 'Partner'
            const wr        = p.wins && p.total_matches
              ? Math.round((p.wins / p.total_matches) * 100) : null

            return (
              <div key={p.id} className={styles.playerRow}
                style={isSupport ? { border:'1px solid var(--accent)' } : {}}
                onClick={() => router.push(`/profile/${p.id}`)}>

                {/* Rank */}
                {!isSupport
                  ? <span className={styles.rankNum}>#{rankById[p.id]}</span>
                  : <span style={{ fontSize:18, width:28, textAlign:'center', flexShrink:0 }}>
                      <i className="ri-customer-service-2-line" style={{ color:'var(--accent)' }}/>
                    </span>
                }

                {/* Avatar — no border, online dot overlay */}
                <div className={styles.avatarWrap}>
                  <div className={styles.playerAvatar}>
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt=""/>
                      : <span>{(p.username || '?').slice(0, 2).toUpperCase()}</span>
                    }
                  </div>
                  <span className={styles.onlineDot}
                    style={{ background: isOnline ? '#22c55e' : 'var(--border-dark)' }}/>
                </div>

                {/* Info */}
                <div className={styles.playerInfo}>
                  <span className={styles.playerName}>
                    {p.username}
                    <UserBadges
                      email={p.email} plan={p.plan} planExpiresAt={p.plan_expires_at}
                      countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner} customBadges={p.custom_badges} tempAdminUntil={p.temp_admin_until}
                      size={13} gap={2}/>
                  </span>
                  {!isSupport ? (
                    <span className={styles.playerMeta}>
                      {isPartner ? (
                        <span style={{ color:'#22c55e', fontWeight:800, fontSize:10, letterSpacing:'.06em' }}>
                          <i className="ri-shield-star-fill"/> PARTNER
                        </span>
                      ) : (
                        <span style={{ color: rankMeta.color, fontWeight:700 }}>{p.tier}</span>
                      )}
                      {' · '}Lv.{p.level ?? 1}
                      {' · '}{p.wins ?? 0}W
                      {wr !== null && <span style={{ color:'var(--text-dim)' }}> · {wr}%WR</span>}
                    </span>
                  ) : (
                    <span className={styles.playerMeta}
                      style={{ color:'var(--accent)', fontWeight:600 }}>
                      Official Support · Tap to contact
                    </span>
                  )}
                  {!isSupport && (
                    <span className={styles.presenceText}
                      style={{ color: isOnline ? '#22c55e' : 'var(--text-muted)' }}>
                      {presenceLabel(isOnline, p.last_seen).text}
                    </span>
                  )}</div>

                {/* Actions */}
                {user?.id !== p.id && (
                  <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
                    <button
                      className={`${styles.followBtn} ${following[p.id] ? styles.following : ''}`}
                      onClick={e => toggleFollow(e, p.id)}
                      title={following[p.id] ? 'Unfollow' : 'Follow'}>
                      <i className={following[p.id] ? 'ri-user-check-line' : 'ri-user-add-line'}/>
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div style={{ padding:'36px 0', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
              <i className="ri-user-search-line"
                style={{ fontSize:28, display:'block', marginBottom:8, opacity:.35 }}/>
              No players found.
            </div>
          )}

        </div>
      )}
    </div>
  )
}
