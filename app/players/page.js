'use client'
import { useState, useEffect } from 'react'
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

export default function PlayersPage() {
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()
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

  const PAGE_SIZE = 30

  useEffect(() => { loadPlayers(0) }, [])

  useEffect(() => {
    if (!user || players.length === 0) return
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
      .order('wins', { ascending: false })
      .range(from, to)
    const rows = data || []
    if (pageNum === 0) {
      setPlayers(rows)
    } else {
      setPlayers(p => [...p, ...rows])
    }
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
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', playerId)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: playerId })
    }
  }

  async function sendChallenge() {
    if (!user) { openAuthGate(); return }
    const slug = `${(profile?.username || 'player').toLowerCase().replace(/[^a-z0-9]/g, '')}-vs-${(challengeTarget.username || 'player').toLowerCase().replace(/[^a-z0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
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
    const slug = `open-${recruitGame}-${Math.random().toString(36).slice(2, 8)}`
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
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Season {getCurrentSeason()} · PlayWithFriends</p>
          <h1 className={styles.headline}>PLAYERS</h1>
        </div>
        <button className={styles.recruitHeaderBtn}
          onClick={() => { if (!user) { openAuthGate(); return } setRecruitOpen(true) }}>
          <i className="ri-megaphone-line" /> Recruit
        </button>
      </div>

      <div className={styles.searchWrap}>
        <i className="ri-search-line" />
        <input className={styles.searchInput} placeholder="Search players…"
          value={search} onChange={e => setSearch(e.target.value)} />
        {search && (
          <button onClick={() => setSearch('')}
            style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:0, fontSize:16 }}>
            <i className="ri-close-line" />
          </button>
        )}
      </div>

      {/* Stats strip */}
      <div style={{ display:'flex', gap:8, marginBottom:14, fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>
        <span><i className="ri-group-line" style={{ marginRight:3 }}/>{players.length} players</span>
        <span>·</span>
        <span style={{ color:'#22c55e' }}><i className="ri-radio-button-line" style={{ marginRight:3 }}/>{onlineIds.size} online</span>
      </div>

      {!loading && (
        <div className={styles.list}>
          {filtered.map((p, idx) => {
            const rankMeta  = RANK_META[p.tier] || RANK_META.Gold
            const isOnline  = onlineIds.has(p.id)
            const isSupport = isHelpdeskEmail(p.email)
            const isPartner = p.tier === 'Partner'
            const winRate   = p.wins && p.total_matches
              ? Math.round((p.wins / p.total_matches) * 100) : null

            return (
              <div key={p.id} className={styles.playerRow}
                style={isSupport ? { border:'1px solid var(--accent)', background:'var(--card)' } : {}}
                onClick={() => router.push(`/profile/${p.id}`)}>

                {/* Rank number */}
                {!isSupport
                  ? <span className={styles.rankNum}>#{idx + 1}</span>
                  : <span style={{ fontSize:18, width:32, textAlign:'center' }}>
                      <i className="ri-customer-service-2-line" style={{ color:'var(--accent)' }}/>
                    </span>
                }

                {/* Avatar */}
                <div className={styles.playerAvatar} style={
                  isSupport ? { border:'2px solid var(--accent)' } :
                  isPartner ? { border:'2px solid #22c55e', boxShadow:'0 0 0 2px rgba(34,197,94,.2)' } :
                  {}
                }>
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt=""/>
                    : <span>{(p.username || '?').slice(0, 2).toUpperCase()}</span>
                  }
                  {/* Online dot overlaid on avatar */}
                  <span style={{
                    position:'absolute', bottom:0, right:0,
                    width:9, height:9, borderRadius:'50%',
                    background: isOnline ? '#22c55e' : 'var(--border-dark)',
                    border:'2px solid var(--bg)',
                  }}/>
                </div>

                {/* Info */}
                <div className={styles.playerInfo}>
                  <span className={styles.playerName}>
                    {p.username}
                    <UserBadges
                      email={p.email} plan={p.plan} planExpiresAt={p.plan_expires_at}
                      countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner}
                      size={13} gap={2}
                    />
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
                      {winRate !== null && <span style={{ color:'var(--text-dim)' }}> · {winRate}%WR</span>}
                      {' · '}<i className="ri-user-follow-line"/> {p.followers_count ?? 0}
                    </span>
                  ) : (
                    <span className={styles.playerMeta} style={{ color:'var(--accent)', fontWeight:600 }}>
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

          {filtered.length === 0 && !loading && (
            <div style={{ padding:'32px 0', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
              <i className="ri-user-search-line" style={{ fontSize:28, display:'block', marginBottom:8, opacity:.4 }}/>
              No players found.
            </div>
          )}

          {/* Load more */}
          {!search && hasMore && (
            <button
              onClick={() => loadPlayers(page + 1)}
              style={{
                width:'100%', padding:'12px 0', marginTop:6,
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:10, color:'var(--text-muted)', fontSize:12, fontWeight:700,
                cursor:'pointer',
              }}>
              Load more players
            </button>
          )}
        </div>
      )}

      {loading && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {[...Array(8)].map((_, i) => (
            <div key={i} style={{
              height:62, borderRadius:12, background:'var(--surface)',
              border:'1px solid var(--border)',
              opacity: 1 - i * 0.1,
            }}/>
          ))}
        </div>
      )}

      {/* ── Challenge Modal ── */}
      <Modal open={!!challengeTarget}
        onClose={() => { setChallengeTarget(null); setSent(false); setFormat(''); setScheduledAt('') }}
        title="Request Match" size="sm"
        footer={
          sent
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
                    <i className={GAME_META[g]?.icon} style={{ marginRight:5 }}/>{GAME_META[g]?.name || g}
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
              <input className={styles.textInput} placeholder="e.g. Bo3, Bo5, Round Robin…"
                value={format} onChange={e => setFormat(e.target.value)}/>
            </div>
            <div className={styles.formField}>
              <label>Proposed Date & Time</label>
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
        footer={
          recruitSent
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
                  <i className={GAME_META[g]?.icon} style={{ marginRight:5 }}/>{GAME_META[g]?.name || g}
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
