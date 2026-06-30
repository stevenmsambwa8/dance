'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../components/Modal'
import { useAuth, isHelpdeskEmail } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'
import { getCurrentSeason } from '../../lib/seasons'
import UserBadges from '../../components/UserBadges'
import { useOnlineUsers } from '../../lib/usePresence'
import { RANK_META, GAME_SLUGS, GAME_META } from '../../lib/constants'

const GAME_MODES = ['Elimination', 'Capture', 'Deathmatch', 'Sniper', 'Team Battle']
const PAGE_SIZE  = 30

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
                  countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner}
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
  const [challengeTarget, setChallengeTarget] = useState(null)
  const [game, setGame]                 = useState(GAME_SLUGS[0])
  const [mode, setMode]                 = useState(GAME_MODES[0])
  const [format, setFormat]             = useState('')
  const [scheduledAt, setScheduledAt]   = useState('')
  const [sent, setSent]                 = useState(false)
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [page, setPage]                 = useState(0)
  const [hasMore, setHasMore]           = useState(true)
  usePageLoading(loading)
  const onlineIds = useOnlineUsers()

  const [recruitOpen, setRecruitOpen]       = useState(false)
  const [recruitGame, setRecruitGame]       = useState(GAME_SLUGS[0])
  const [recruitMode, setRecruitMode]       = useState(GAME_MODES[0])
  const [recruitMessage, setRecruitMessage] = useState('')
  const [recruitSent, setRecruitSent]       = useState(false)
  const [recruitSending, setRecruitSending] = useState(false)

  useEffect(() => { loadPlayers(0) }, [])

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

  async function loadPlayers(pageNum = 0) {
    setLoading(true)
    const from = pageNum * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('level', { ascending: false })
      .order('wins',  { ascending: false })
      .range(from, to)
    const rows = data || []
    setPlayers(prev => pageNum === 0 ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setPage(pageNum)
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

  async function sendChallenge() {
    if (!user) { openAuthGate(); return }
    const slug = `${(profile?.username||'p').toLowerCase().replace(/[^a-z0-9]/g,'')}-vs-${(challengeTarget.username||'p').toLowerCase().replace(/[^a-z0-9]/g,'')}-${Math.random().toString(36).slice(2,8)}`
    await supabase.from('matches').insert({
      challenger_id: user.id, challenged_id: challengeTarget.id,
      game, game_mode: mode, format, status: 'pending',
      slug, scheduled_at: scheduledAt || null,
    })
    setSent(true)
    setTimeout(() => { setSent(false); setChallengeTarget(null); setFormat(''); setScheduledAt('') }, 1800)
  }

  async function sendRecruit() {
    if (!user) { openAuthGate(); return }
    setRecruitSending(true)
    const slug = `open-${recruitGame}-${Math.random().toString(36).slice(2,8)}`
    const { data: match, error } = await supabase.from('matches').insert({
      challenger_id: user.id, challenged_id: null,
      game: recruitGame, game_mode: recruitMode,
      status: 'recruiting', slug, recruiting: true,
      recruit_message: recruitMessage || null,
    }).select().single()
    if (!error && match) {
      await supabase.rpc('recruit_for_match', {
        p_match_id: match.id, p_game_slug: recruitGame,
        p_creator_id: user.id, p_message: recruitMessage || null,
      })
    }
    setRecruitSending(false)
    setRecruitSent(true)
    setTimeout(() => {
      setRecruitSent(false); setRecruitOpen(false); setRecruitMessage('')
      if (match) router.push(`/matches/${match.slug}`)
    }, 1400)
  }

  const filtered = players.filter(p =>
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
        <button className={styles.recruitHeaderBtn}
          onClick={() => { if (!user) { openAuthGate(); return } setRecruitOpen(true) }}>
          <i className="ri-megaphone-line"/> Recruit
        </button>
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
      {loading && page === 0 && (
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
          {filtered.map((p, idx) => {
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
                  ? <span className={styles.rankNum}>#{idx + 1}</span>
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
                      countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner}
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
                </div>

                {/* Actions */}
                {user?.id !== p.id && (
                  <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
                    <button
                      className={`${styles.followBtn} ${following[p.id] ? styles.following : ''}`}
                      onClick={e => toggleFollow(e, p.id)}
                      title={following[p.id] ? 'Unfollow' : 'Follow'}>
                      <i className={following[p.id] ? 'ri-user-check-line' : 'ri-user-add-line'}/>
                    </button>
                    {!isSupport && (
                      <button className={styles.challengeBtn}
                        onClick={e => { e.stopPropagation(); setChallengeTarget(p) }}
                        title="Challenge">
                        <i className="ri-sword-line"/>
                      </button>
                    )}
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

          {!search && hasMore && (
            <button className={styles.loadMoreBtn}
              onClick={() => loadPlayers(page + 1)}>
              Load more players
            </button>
          )}
        </div>
      )}

      {/* ── Challenge Modal ── */}
      <Modal open={!!challengeTarget}
        onClose={() => { setChallengeTarget(null); setSent(false); setFormat(''); setScheduledAt('') }}
        title="Request Match" size="sm"
        footer={sent
          ? <span className={styles.sentMsg}><i className="ri-check-line"/> Request sent!</span>
          : <button className={styles.sendBtn} onClick={sendChallenge}>
              <i className="ri-send-plane-line"/> Send Challenge
            </button>
        }>
        {challengeTarget && (
          <div className={styles.challengeBody}>
            <div className={styles.challengePlayer}>
              <div className={styles.chAvatar}>
                {challengeTarget.avatar_url
                  ? <img src={challengeTarget.avatar_url} alt=""
                      style={{ width:'100%', height:'100%', objectFit:'cover', borderRadius:8 }}/>
                  : challengeTarget.username.slice(0, 2).toUpperCase()
                }
              </div>
              <div>
                <div className={styles.chName}>{challengeTarget.username}</div>
                <div className={styles.chRank}>Lv.{challengeTarget.level ?? 1} · {challengeTarget.tier}</div>
              </div>
            </div>
            <div className={styles.formField}>
              <label>Game</label>
              <div className={styles.modeGrid}>
                {GAME_SLUGS.map(g => (
                  <button key={g} className={`${styles.modeBtn} ${game === g ? styles.modeActive : ''}`}
                    onClick={() => setGame(g)}>
                    <i className={GAME_META[g]?.icon} style={{ marginRight:4 }}/>{GAME_META[g]?.name || g}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.formField}>
              <label>Game Mode</label>
              <div className={styles.modeGrid}>
                {GAME_MODES.map(m => (
                  <button key={m} className={`${styles.modeBtn} ${mode === m ? styles.modeActive : ''}`}
                    onClick={() => setMode(m)}>{m}</button>
                ))}
              </div>
            </div>
            <div className={styles.formField}>
              <label>Format</label>
              <input className={styles.textInput} placeholder="e.g. Bo3, Bo5…"
                value={format} onChange={e => setFormat(e.target.value)}/>
            </div>
            <div className={styles.formField}>
              <label>Date & Time</label>
              <input type="datetime-local" className={styles.textInput}
                value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}/>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Recruit Modal ── */}
      <Modal open={recruitOpen}
        onClose={() => { if (!recruitSending) { setRecruitOpen(false); setRecruitSent(false); setRecruitMessage('') } }}
        title="Recruit an Opponent" size="sm"
        footer={recruitSent
          ? <span className={styles.sentMsg}><i className="ri-check-line"/> Call-out sent!</span>
          : <button className={styles.sendBtn} disabled={recruitSending} onClick={sendRecruit}>
              <i className="ri-megaphone-line"/> {recruitSending ? 'Sending…' : 'Post & Notify'}
            </button>
        }>
        <div className={styles.challengeBody}>
          <p style={{ fontSize:12, color:'var(--text-muted)', margin:0, lineHeight:1.5 }}>
            Creates an open match. Everyone subscribed to the game gets notified — first to tap Join takes the slot.
          </p>
          <div className={styles.formField}>
            <label>Game</label>
            <div className={styles.modeGrid}>
              {GAME_SLUGS.map(g => (
                <button key={g} className={`${styles.modeBtn} ${recruitGame === g ? styles.modeActive : ''}`}
                  onClick={() => setRecruitGame(g)}>
                  <i className={GAME_META[g]?.icon} style={{ marginRight:4 }}/>{GAME_META[g]?.name || g}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.formField}>
            <label>Game Mode</label>
            <div className={styles.modeGrid}>
              {GAME_MODES.map(m => (
                <button key={m} className={`${styles.modeBtn} ${recruitMode === m ? styles.modeActive : ''}`}
                  onClick={() => setRecruitMode(m)}>{m}</button>
              ))}
            </div>
          </div>
          <div className={styles.formField}>
            <label>Message (optional)</label>
            <input className={styles.textInput} placeholder="e.g. Looking for a Bo3 tonight at 9PM"
              value={recruitMessage} onChange={e => setRecruitMessage(e.target.value)} maxLength={120}/>
          </div>
        </div>
      </Modal>
    </div>
  )
}
