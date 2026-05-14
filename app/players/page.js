'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../components/Modal'
import { useAuth, isHelpdeskEmail } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'
import { getCurrentSeason, getSeasonDateRange, getDaysRemaining } from '../../lib/seasons'
import UserBadges from '../../components/UserBadges'
import { useOnlineUsers } from '../../lib/usePresence'

const ADMIN_EMAIL = 'stevenmsambwa8@gmail.com'
const GAME_MODES = ['Elimination', 'Capture', 'Deathmatch', 'Sniper', 'Team Battle']

export default function Contact() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [players, setPlayers] = useState([])
  const [following, setFollowing] = useState({})
  const [challengeTarget, setChallengeTarget] = useState(null)
  const [mode, setMode] = useState(GAME_MODES[0])
  const [format, setFormat] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)
  const [search, setSearch] = useState('')
  const onlineIds = useOnlineUsers()

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
    if (!user) return router.push('/login')
    const isFollowing = following[playerId]
    setFollowing(f => ({ ...f, [playerId]: !isFollowing }))
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', playerId)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: playerId })
    }
  }

  async function sendChallenge() {
    if (!user) return router.push('/login')
    const slug = `${(profile?.username || 'player').toLowerCase().replace(/[^a-z0-9]/g, '')}-vs-${(challengeTarget.username || 'player').toLowerCase().replace(/[^a-z0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
    await supabase.from('matches').insert({
      challenger_id: user.id,
      challenged_id: challengeTarget.id,
      game_mode: mode,
      format,
      status: 'pending',
      slug,
      scheduled_at: scheduledAt || null,
    })
    setSent(true)
    setTimeout(() => { setSent(false); setChallengeTarget(null); setFormat(''); setScheduledAt('') }, 1800)
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
              <div className={styles.playerAvatar} style={isHelpdeskEmail(p.email) ? { border: '2px solid var(--accent)' } : {}}>
                {p.avatar_url
                  ? <img src={p.avatar_url} alt="" />
                  : <span>{(p.username || '?').slice(0, 2).toUpperCase()}</span>
                }
              </div>
              <div className={styles.playerInfo}>
                <span className={styles.playerName}>
                  {p.username}
                  <UserBadges email={p.email} countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner} size={13} gap={2} />
                </span>
                {!isHelpdeskEmail(p.email)
                  ? <span className={styles.playerMeta}>{p.tier} · Lv.{p.level ?? 1} · {p.wins}W · <i className="ri-user-follow-line" /> {p.followers_count || 0}</span>
                  : <span className={styles.playerMeta} style={{ color: 'var(--accent)', fontWeight: 600 }}>Official Support · Tap to contact</span>
                }
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
    </div>
  )
}
