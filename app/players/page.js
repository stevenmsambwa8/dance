'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../components/Modal'
import { useAuth, isHelpdeskEmail } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'
import { getCurrentSeason, getSeasonDateRange, getDaysRemaining } from '../../lib/seasons'
import UserBadges from '../../components/UserBadges'
import PlanBadge from '../../components/PlanBadge'
import { useOnlineUsers } from '../../lib/usePresence'
import { RANK_META, GAME_SLUGS, GAME_META } from '../../lib/constants'

const ADMIN_EMAIL = 'stevenmsambwa8@gmail.com'
const GAME_MODES = ['Elimination', 'Capture', 'Deathmatch', 'Sniper', 'Team Battle']

export default function Contact() {
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()
  const [players, setPlayers] = useState([])
  const [following, setFollowing] = useState({})
  const [challengeTarget, setChallengeTarget] = useState(null)
  const [game, setGame] = useState(GAME_SLUGS[0])
  const [mode, setMode] = useState(GAME_MODES[0])
  const [format, setFormat] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)
  const [search, setSearch] = useState('')
  const onlineIds = useOnlineUsers()

  // ── Recruit (open match, no specific opponent) ──
  const [recruitOpen, setRecruitOpen] = useState(false)
  const [recruitGame, setRecruitGame] = useState(GAME_SLUGS[0])
  const [recruitMode, setRecruitMode] = useState(GAME_MODES[0])
  const [recruitMessage, setRecruitMessage] = useState('')
  const [recruitSent, setRecruitSent] = useState(false)
  const [recruitSending, setRecruitSending] = useState(false)

  useEffect(() => {
    loadPlayers()
  }, [])

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

  async function loadPlayers() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
            .order('level', { ascending: false })
      .limit(50)
    setPlayers(data || [])
    setLoading(false)
  }

  async function toggleFollow(e, playerId) {
    e.stopPropagation()
    if (!user) { openAuthGate(); return }
    const isFollowing = following[playerId]
    setFollowing(f => ({ ...f, [playerId]: !isFollowing }))
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', playerId)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: playerId })
    }
  }

  async function sendChallenge() {
    if (!user) { openAuthGate(); return }
    const slug = `${(profile?.username || 'player').toLowerCase().replace(/[^a-z0-9]/g, '')}-vs-${(challengeTarget.username || 'player').toLowerCase().replace(/[^a-z0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
    await supabase.from('matches').insert({
      challenger_id: user.id,
      challenged_id: challengeTarget.id,
      game,
      game_mode: mode,
      format,
      status: 'pending',
      slug,
      scheduled_at: scheduledAt || null,
    })
    setSent(true)
    setTimeout(() => { setSent(false); setChallengeTarget(null); setFormat(''); setScheduledAt('') }, 1800)
  }

  // ── Create a "recruiting" match: no opponent yet, notifies everyone
  // subscribed to that game via the recruit_for_match RPC. Whoever taps
  // "Join" first on the matches page becomes challenged_id (handled there).
  async function sendRecruit() {
    if (!user) { openAuthGate(); return }
    setRecruitSending(true)
    const slug = `open-${recruitGame}-${Math.random().toString(36).slice(2, 8)}`
    const { data: match, error } = await supabase.from('matches').insert({
      challenger_id: user.id,
      challenged_id: null,
      game: recruitGame,
      game_mode: recruitMode,
      status: 'recruiting',
      slug,
      recruiting: true,
      recruit_message: recruitMessage || null,
    }).select().single()

    if (!error && match) {
      await supabase.rpc('recruit_for_match', {
        p_match_id: match.id,
        p_game_slug: recruitGame,
        p_creator_id: user.id,
        p_message: recruitMessage || null,
      })
    }
    setRecruitSending(false)
    setRecruitSent(true)
    setTimeout(() => {
      setRecruitSent(false)
      setRecruitOpen(false)
      setRecruitMessage('')
      if (match) router.push(`/matches/${match.slug}`)
    }, 1400)
  }

  function sendDM(e, playerId) {
    e.stopPropagation()
    router.push(`/dm?with=${playerId}`)
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
        <button className={styles.recruitHeaderBtn} onClick={() => { if (!user) { openAuthGate(); return } setRecruitOpen(true) }}>
          <i className="ri-megaphone-line" /> Recruit
        </button>
      </div>

      <div className={styles.searchWrap}>
        <i className="ri-search-line" />
        <input
          className={styles.searchInput}
          placeholder="Search players…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {!loading && (
        <div className={styles.list}>
          {filtered.map((p) => (
            <div
              key={p.id}
              className={styles.playerRow}
              style={isHelpdeskEmail(p.email) ? { background: 'var(--card)', border: '1px solid var(--accent)', borderRadius: 12, opacity: 1 } : {}}
              onClick={() => router.push(`/profile/${p.id}`)}
            >
              {!isHelpdeskEmail(p.email)
                ? <span className={styles.rankNum}>Lv.{p.level ?? 1}</span>
                : <span style={{ fontSize: 20, width: 36, textAlign: 'center' }}><i className="ri-customer-service-2-line" style={{ color: 'var(--accent)' }} /></span>
              }
              <div className={styles.playerAvatar} style={
                isHelpdeskEmail(p.email) ? { border: '2px solid var(--accent)' } :
                p.tier === 'Partner' ? { border: '2px solid #22c55e', boxShadow: '0 0 0 1px rgba(34,197,94,0.3)' } :
                {}
              }>
                {p.avatar_url
                  ? <img src={p.avatar_url} alt="" />
                  : <span>{(p.username || '?').slice(0, 2).toUpperCase()}</span>
                }
              </div>
              <div className={styles.playerInfo}>
                <span className={styles.playerName}>
                  {p.username}
                  <PlanBadge plan={p.plan} planExpiresAt={p.plan_expires_at} size="sm" />
                  <UserBadges email={p.email} plan={p.plan} planExpiresAt={p.plan_expires_at} countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner} size={13} gap={2} />
                </span>
                {!isHelpdeskEmail(p.email) ? (
                  <span className={styles.playerMeta}>
                    {p.tier === 'Partner' ? (
                      <span style={{ color: '#22c55e', fontWeight: 800, fontSize: 10, letterSpacing: '0.06em' }}>
                        <i className="ri-shield-star-fill" /> PARTNER
                      </span>
                    ) : (
                      <span style={{ color: (RANK_META[p.tier] || RANK_META.Gold).color, fontWeight: 700 }}>
                        {p.tier}
                      </span>
                    )}
                    {' · '}Lv.{p.level ?? 1} · {p.wins}W · <i className="ri-user-follow-line" /> {p.followers_count || 0}
                  </span>
                ) : (
                  <span className={styles.playerMeta} style={{ color: 'var(--accent)', fontWeight: 600 }}>Official Support · Tap to contact</span>
                )}
              </div>
              <span className={`${styles.statusDot} ${onlineIds.has(p.id) ? styles.online : styles.offline}`} title={onlineIds.has(p.id) ? 'Online' : 'Offline'} />
              {user?.id !== p.id && (
                <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
                  <button
                    className={`${styles.followBtn} ${following[p.id] ? styles.following : ''}`}
                    onClick={(e) => toggleFollow(e, p.id)}
                  >
                    <i className={following[p.id] ? 'ri-user-check-line' : 'ri-user-add-line'} />
                  </button>
                  {!isHelpdeskEmail(p.email) && <button className={styles.challengeBtn} onClick={(e) => { e.stopPropagation(); setChallengeTarget(p) }}>
                    <i className="ri-sword-line" />
                  </button>}
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>No players found.</p>}
        </div>
      )}

      {/* ── 1-on-1 Challenge Modal ── */}
      <Modal
        open={!!challengeTarget}
        onClose={() => { setChallengeTarget(null); setSent(false); setFormat(''); setScheduledAt('') }}
        title="Request Match"
        size="sm"
        footer={
          sent
            ? <span className={styles.sentMsg}><i className="ri-check-line" /> Request sent!</span>
            : <button className={styles.sendBtn} onClick={sendChallenge}>
                <i className="ri-send-plane-line" /> Send Challenge
              </button>
        }
      >
        {challengeTarget && (
          <div className={styles.challengeBody}>
            <div className={styles.challengePlayer}>
              <div className={styles.chAvatar}>
                {challengeTarget.avatar_url
                  ? <img src={challengeTarget.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
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
                  <button key={g} className={`${styles.modeBtn} ${game === g ? styles.modeActive : ''}`} onClick={() => setGame(g)}>
                    <i className={GAME_META[g]?.icon} style={{ marginRight: 5 }} />{GAME_META[g]?.name || g}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.formField}>
              <label>Game Mode</label>
              <div className={styles.modeGrid}>
                {GAME_MODES.map(m => (
                  <button key={m} className={`${styles.modeBtn} ${mode === m ? styles.modeActive : ''}`} onClick={() => setMode(m)}>{m}</button>
                ))}
              </div>
            </div>

            <div className={styles.formField}>
              <label>Format</label>
              <input
                className={styles.textInput}
                placeholder="e.g. Bo3, Bo5, Round Robin…"
                value={format}
                onChange={e => setFormat(e.target.value)}
              />
            </div>

            <div className={styles.formField}>
              <label>Proposed Date & Time</label>
              <input
                type="datetime-local"
                className={styles.textInput}
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* ── Recruit Modal — open match call-out, notifies game subscribers ── */}
      <Modal
        open={recruitOpen}
        onClose={() => { if (!recruitSending) { setRecruitOpen(false); setRecruitSent(false); setRecruitMessage('') } }}
        title="Recruit an Opponent"
        size="sm"
        footer={
          recruitSent
            ? <span className={styles.sentMsg}><i className="ri-check-line" /> Call-out sent!</span>
            : <button className={styles.sendBtn} disabled={recruitSending} onClick={sendRecruit}>
                <i className="ri-megaphone-line" /> {recruitSending ? 'Sending…' : 'Post & Notify Subscribers'}
              </button>
        }
      >
        <div className={styles.challengeBody}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            This creates an open match with no opponent yet. Everyone subscribed to the selected game gets notified, and the first player to tap "Join" takes the open slot.
          </p>

          <div className={styles.formField}>
            <label>Game</label>
            <div className={styles.modeGrid}>
              {GAME_SLUGS.map(g => (
                <button key={g} className={`${styles.modeBtn} ${recruitGame === g ? styles.modeActive : ''}`} onClick={() => setRecruitGame(g)}>
                  <i className={GAME_META[g]?.icon} style={{ marginRight: 5 }} />{GAME_META[g]?.name || g}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.formField}>
            <label>Game Mode</label>
            <div className={styles.modeGrid}>
              {GAME_MODES.map(m => (
                <button key={m} className={`${styles.modeBtn} ${recruitMode === m ? styles.modeActive : ''}`} onClick={() => setRecruitMode(m)}>{m}</button>
              ))}
            </div>
          </div>

          <div className={styles.formField}>
            <label>Message (optional)</label>
            <input
              className={styles.textInput}
              placeholder="e.g. Looking for a Bo3 tonight at 9PM"
              value={recruitMessage}
              onChange={e => setRecruitMessage(e.target.value)}
              maxLength={120}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
