'use client'
import { useState, useEffect, useRef } from 'react'
import Modal from '../../components/Modal'
import { useAuth } from '../../components/AuthProvider'
import { getTierTheme } from '../../lib/tierTheme'
import { supabase } from '../../lib/supabase'
import UserBadges from '../../components/UserBadges'

const ADMIN_EMAIL = 'stevenmsambwa8@gmail.com'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'

import { GAME_META, GAME_SLUGS, RANK_TIERS } from '../../lib/constants'
import { getCurrentSeason, getSeasonDateRange, getDaysRemaining } from '../../lib/seasons'
const ALL_GAMES = GAME_SLUGS.map(s => GAME_META[s].name)
const PLAY_STYLES = ['Aggressive', 'Defensive', 'Support', 'Sniper', 'All-Round']

const FLAG_OPTIONS = [
  { value: 'kenya',    label: 'Kenya' },
  { value: 'tanzania', label: 'Tanzania' },
  { value: 'uganda',   label: 'Uganda' },
]

export default function About() {
  const { user, profile, updateProfile, uploadAvatar, isAdmin } = useAuth()
  const [editModal, setEditModal] = useState(false)
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [playStyle, setPlayStyle] = useState('Aggressive')
  const [gameTags, setGameTags] = useState([])
  const [countryFlag, setCountryFlag] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [achievements, setAchievements] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [followStats, setFollowStats] = useState({ followers: 0, following: 0 })
  const fileRef = useRef()

  useEffect(() => {
    if (profile) {
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setPlayStyle(profile.play_style || 'Aggressive')
      setGameTags(profile.game_tags || [])
      setCountryFlag(profile.country_flag || '')
    }
  }, [profile])

  useEffect(() => {
    if (!user) return
    async function load() {
      const [{ data: ach }, { data: hist }, { count: followersCount }, { count: followingCount }] = await Promise.all([
        supabase.from('achievements').select('*').eq('user_id', user.id).order('unlocked_at', { ascending: false }),
        supabase.from('season_history').select('*').eq('user_id', user.id).order('season_number', { ascending: false }),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', user.id),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', user.id),
      ])
      setAchievements(ach || [])
      setHistory(hist || [])
      setFollowStats({ followers: followersCount || 0, following: followingCount || 0 })
      setLoading(false)
    }
    load()
  }, [user])

  async function saveProfile() {
    setSaving(true)
    setSaveError('')
    try {
      await updateProfile({ username, bio, play_style: playStyle, game_tags: gameTags, country_flag: countryFlag || null })
      setEditModal(false)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarLoading(true)
    try {
      await uploadAvatar(file)
    } catch (e) {
      alert('Avatar upload failed: ' + e.message)
    } finally {
      setAvatarLoading(false)
    }
  }

  function toggleGameTag(game) {
    setGameTags(t => t.includes(game) ? t.filter(x => x !== game) : [...t, game])
  }

  if (!user) return (
    <div className={styles.page} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <p style={{ color: 'var(--text-muted)' }}>Please <a href="/login" style={{ color: 'var(--text)', fontWeight: 700 }}>log in</a> to view your profile.</p>
    </div>
  )

  const initials = (profile?.username || 'P1').slice(0, 2).toUpperCase()
  const winRate = profile ? ((profile.wins / Math.max(profile.wins + profile.losses, 1)) * 100).toFixed(0) + '%' : '—'
  const theme = getTierTheme(profile?.tier)

  return (
    <div className={styles.page}>
      <div className={styles.profileCard} style={{
        background: theme.gradient,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        padding: '20px 16px',
        marginBottom: 0,
        boxShadow: `0 0 0 1px ${theme.border}, 0 4px 24px ${theme.glow}`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div className={styles.avatarWrap} onClick={() => fileRef.current?.click()}>
          {avatarLoading
            ? <div className={styles.avatar} style={{ opacity: 0.5 }}><i className="ri-loader-4-line" /></div>
            : profile?.avatar_url
              ? <img src={profile.avatar_url} className={styles.avatarPhoto} alt="" style={{ outline: `3px solid ${theme.avatarRing.includes('gradient') ? theme.primary : theme.avatarRing}`, outlineOffset: 2 }} />
              : <div className={styles.avatar} style={{ background: theme.primary, color: '#fff' }}>{initials}</div>
          }
          <div className={styles.avatarOverlay}><i className="ri-camera-line" /></div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
        </div>
        <div className={styles.profileInfo}>
          <h1 className={styles.username}>
            {profile?.username || '—'}
            <UserBadges
              email={profile?.email}
              countryFlag={profile?.country_flag}
              isSeasonWinner={profile?.is_season_winner}
              size={18}
            />
          </h1>
          <p className={styles.tagline}>{profile?.play_style || 'Player'} · {profile?.tier || '—'} · Season {getCurrentSeason()}</p>
          {(profile?.game_tags || []).length > 0 && (
            <div className={styles.gameTags}>
              {(profile.game_tags).map(g => <span key={g} className={styles.gameTag}>{g}</span>)}
            </div>
          )}
        </div>
        <button className={styles.editBtn} onClick={() => setEditModal(true)}>
          <i className="ri-edit-line" /> Edit
        </button>
      </div>

      <div className={styles.followRow}>
        <div className={styles.followStat}><strong>{followStats.followers}</strong><span>Followers</span></div>
        <div className={styles.followStat}><strong>{followStats.following}</strong><span>Following</span></div>
      </div>

      <div className={styles.statsRow}>
        {[
          { label: 'Wins', value: profile?.wins ?? '—' },
          { label: 'Losses', value: profile?.losses ?? '—' },
          { label: 'Win Rate', value: winRate },
          { label: 'Points', value: profile?.points?.toLocaleString() ?? '—' },
        ].map(s => (
          <div key={s.label} className={styles.miniStat}>
            <span className={styles.miniValue}>{s.value}</span>
            <span className={styles.miniLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      {profile?.bio && (
        <section className={styles.section}>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>{profile.bio}</p>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Achievements</h2>
        {!loading && achievements.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No achievements yet. Start competing!</p>
        ) : (
          <div className={styles.achievements}>
            {achievements.map(a => (
              <div key={a.id} className={styles.achievement}>
                <i className={`${a.icon} ${styles.achIcon}`} />
                <div>
                  <div className={styles.achLabel}>{a.label}</div>
                  <div className={styles.achDate}>{new Date(a.unlocked_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Season History</h2>
        {!loading && history.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No season history yet.</p>
        ) : (
          <div className={styles.historyList}>
            {history.map(h => (
              <div key={h.id} className={styles.historyRow}>
                <span className={styles.historySeason}>Season {h.season_number}</span>
                <span className={styles.historyRank}>#{h.final_rank}</span>
                <span className={styles.historyTier}>{h.tier}</span>
                <span className={styles.historyPts}>{h.points.toLocaleString()} PTS</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={editModal}
        onClose={() => { setEditModal(false); setSaveError('') }}
        title="Edit Profile"
        size="sm"
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            {saveError && <p style={{ color: '#ef4444', fontSize: '0.8rem' }}>{saveError}</p>}
            <button className={styles.saveBtn} onClick={saveProfile} disabled={saving}>
              <i className="ri-check-line" /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        }
      >
        <div className={styles.editForm}>
          <div className={styles.editField}>
            <label>Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div className={styles.editField}>
            <label>Bio</label>
            <textarea rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell other players about yourself..." />
          </div>
          <div className={styles.editField}>
            <label>Play Style</label>
            <select value={playStyle} onChange={e => setPlayStyle(e.target.value)}>
              {PLAY_STYLES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className={styles.editField}>
            <label>Country</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {FLAG_OPTIONS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setCountryFlag(prev => prev === f.value ? '' : f.value)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 5,
                    padding: '10px 6px',
                    border: `1px solid ${countryFlag === f.value ? 'var(--text)' : 'var(--border-dark)'}`,
                    borderRadius: 6,
                    background: countryFlag === f.value ? 'var(--surface)' : 'var(--bg-2)',
                    color: countryFlag === f.value ? 'var(--text)' : 'var(--text-muted)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <img src={`/${f.value}.png`} alt={f.label} style={{ width: 22, height: 22, borderRadius: 3 }} />
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.editField}>
            <label>Game Tags</label>
            <div className={styles.gameTagGrid}>
              {ALL_GAMES.map(g => (
                <button
                  key={g}
                  type="button"
                  className={`${styles.gameTagBtn} ${gameTags.includes(g) ? styles.gameTagActive : ''}`}
                  onClick={() => toggleGameTag(g)}
                >{g}</button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
