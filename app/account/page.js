'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Modal from '../../components/Modal'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { getTierTheme } from '../../lib/tierTheme'
import { supabase } from '../../lib/supabase'
import UserBadges from '../../components/UserBadges'
import usePageLoading from '../../components/usePageLoading'
import { GAME_META, GAME_SLUGS, RANK_META } from '../../lib/constants'
import { getCurrentSeason } from '../../lib/seasons'
import { useCurrency } from '../../lib/useCurrency'
import styles from './page.module.css'

const ALL_GAMES   = GAME_SLUGS.map(s => GAME_META[s].name)
const PLAY_STYLES = ['Aggressive', 'Defensive', 'Support', 'Sniper', 'All-Round']
const FLAG_OPTIONS = [
  { value: 'kenya',        label: 'Kenya' },
  { value: 'tanzania',     label: 'Tanzania' },
  { value: 'uganda',       label: 'Uganda' },
  { value: 'south-africa', label: 'South Africa' },
  { value: 'nigeria',      label: 'Nigeria' },
]

export default function AccountPage() {
  const { user, profile, updateProfile, uploadAvatar, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()

  // ── Currency hook (unconditional) ──
  const { fmtAmt } = useCurrency(profile?.country_flag ?? null)

  // ── Data ──
  const [achievements, setAchievements] = useState([])
  const [history,      setHistory]      = useState([])
  const [shopItems,    setShopItems]    = useState([])
  const [posts,        setPosts]        = useState([])
  const [followStats,  setFollowStats]  = useState({ followers: 0, following: 0 })
  const [loading,      setLoading]      = useState(true)
  usePageLoading(loading)

  // ── UI state ──
  const [activeTab,    setActiveTab]    = useState('posts')
  const [zoomedAvatar, setZoomedAvatar] = useState(false)
  const [avatarLoading,setAvatarLoading]= useState(false)
  const fileRef = useRef()

  // ── Edit modal state ──
  const [editModal,  setEditModal]  = useState(false)
  const [username,   setUsername]   = useState('')
  const [bio,        setBio]        = useState('')
  const [playStyle,  setPlayStyle]  = useState('Aggressive')
  const [gameTags,   setGameTags]   = useState([])
  const [countryFlag,setCountryFlag]= useState('')
  const [phoneCode,  setPhoneCode]  = useState('255')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState('')

  // Pre-fill edit form whenever profile loads
  useEffect(() => {
    if (!profile) return
    setUsername(profile.username || '')
    setBio(profile.bio || '')
    setPlayStyle(profile.play_style || 'Aggressive')
    setGameTags(profile.game_tags || [])
    setCountryFlag(profile.country_flag || '')
    if (profile.phone) {
      const CODES   = ['254', '255', '256', '27', '234']
      const stripped = profile.phone.replace(/^\+/, '')
      const matched  = CODES.find(c => stripped.startsWith(c))
      if (matched) { setPhoneCode(matched); setPhoneLocal(stripped.slice(matched.length)) }
      else setPhoneLocal(stripped)
    } else {
      setPhoneLocal('')
    }
  }, [profile])

  // Load data
  useEffect(() => {
    if (!user) return
    async function load() {
      const [
        { data: ach },
        { data: hist },
        { data: shop },
        { data: postData },
        { count: followersCount },
        { count: followingCount },
      ] = await Promise.all([
        supabase.from('achievements').select('*').eq('user_id', user.id).order('unlocked_at', { ascending: false }),
        supabase.from('season_history').select('*').eq('user_id', user.id).order('season_number', { ascending: false }),
        supabase
          .from('shop_items')
          .select('id, title, price, category, images:shop_item_images(url)')
          .eq('seller_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase
          .from('posts')
          .select('id, text, created_at, like_count, comment_count')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', user.id),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id',  user.id),
      ])
      setAchievements(ach   || [])
      setHistory(hist        || [])
      setShopItems(shop      || [])
      setPosts(postData      || [])
      setFollowStats({ followers: followersCount || 0, following: followingCount || 0 })
      setLoading(false)
    }
    load()
  }, [user])

  // ── Handlers ──
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarLoading(true)
    try { await uploadAvatar(file) }
    catch (e) { alert('Upload failed: ' + e.message) }
    finally   { setAvatarLoading(false) }
  }

  async function saveProfile() {
    if (phoneLocal.trim() && phoneLocal.trim().length < 6) {
      setPhoneError('Enter a valid phone number.')
      return
    }
    setPhoneError('')
    const fullPhone = phoneLocal.trim()
      ? `+${phoneCode}${phoneLocal.trim().replace(/^0/, '')}`
      : null
    setSaving(true); setSaveError('')
    try {
      await updateProfile({ username, bio, play_style: playStyle, game_tags: gameTags, country_flag: countryFlag || null, phone: fullPhone })
      setEditModal(false)
    } catch (e) { setSaveError(e.message) }
    finally     { setSaving(false) }
  }

  function toggleGameTag(g) {
    setGameTags(t => t.includes(g) ? t.filter(x => x !== g) : [...t, g])
  }

  async function deletePost(id) {
    if (!confirm('Delete this post?')) return
    await supabase.from('posts').delete().eq('id', id).eq('user_id', user.id)
    setPosts(p => p.filter(x => x.id !== id))
  }

  function fmtDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const diff = (Date.now() - d) / 1000
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // ── Guards ──
  if (!user) return (
    <div className={styles.page} style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
      <p style={{ color:'var(--text-muted)' }}>
        Please <button onClick={openAuthGate} style={{ background:'none', border:'none', color:'var(--text)', fontWeight:700, cursor:'pointer', padding:0, textDecoration:'underline', fontFamily:'var(--font)' }}>log in</button> to view your account.
      </p>
    </div>
  )

  const initials  = (profile?.username || 'P').slice(0, 2).toUpperCase()
  const winRate   = profile
    ? ((profile.wins / Math.max((profile.wins || 0) + (profile.losses || 0), 1)) * 100).toFixed(0) + '%'
    : '—'
  const theme     = getTierTheme(profile?.tier)
  const tierMeta  = RANK_META[profile?.tier] || RANK_META.Gold
  const isPartner = profile?.tier === 'Partner'

  const tabCounts = { posts: posts.length, shop: shopItems.length, history: history.length }

  return (
    <div className={styles.page}>

      {/* ── Header bar ── */}
      <div className={styles.header}>
        <div />
        <div style={{display:'flex',gap:8}}>
          <a href="/settings" className={styles.editBtn}>
            <i className="ri-settings-3-line" /> Settings
          </a>
        </div>
      </div>

      {/* ── Hero ── */}
      <div className={styles.hero}>
        {/* Avatar */}
        <div
          className={styles.avatarWrap}
          data-tier={profile?.tier || 'Gold'}
          onClick={() => {
            if (profile?.avatar_url) setZoomedAvatar(true)
            else fileRef.current?.click()
          }}
        >
          {avatarLoading ? (
            <div className={styles.avatarInner}>
              <i className="ri-loader-4-line" style={{ fontSize: 26, opacity: 0.5 }} />
            </div>
          ) : profile?.avatar_url ? (
            <img src={profile.avatar_url} className={styles.avatarImg} alt="" />
          ) : (
            <div className={styles.avatarInner}>{initials}</div>
          )}
          <div className={styles.avatarCamera} onClick={e => { e.stopPropagation(); fileRef.current?.click() }}>
            <i className="ri-camera-line" />
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleAvatarChange} />
        </div>

        {/* Meta */}
        <div className={styles.heroMeta}>
          <div className={styles.heroNameRow}>
            <h1 className={styles.heroName}>{profile?.username || '—'}</h1>
            <UserBadges
              email={profile?.email} plan={profile?.plan} planExpiresAt={profile?.plan_expires_at}
              countryFlag={profile?.country_flag}
              isSeasonWinner={profile?.is_season_winner}
              size={18}
            />
          </div>
          <div className={styles.heroSubRow}>
            {isPartner ? (
              <span className={styles.partnerChip}><i className="ri-shield-star-fill" /> PARTNER</span>
            ) : (
              <span
                className={styles.tierBadge}
                style={{ color: tierMeta.color, borderColor: tierMeta.color + '55', background: tierMeta.color + '18' }}
              >
                <i className={tierMeta.icon} />
                {profile?.tier || 'Gold'}
              </span>
            )}
            <span className={styles.heroDot}>·</span>
            <span className={styles.heroLevel}>Lvl {profile?.level ?? '—'}</span>
            <span className={styles.heroDot}>·</span>
            <span className={styles.heroPlayStyle}>{profile?.play_style || 'Player'}</span>
          </div>
          {(profile?.game_tags || []).length > 0 && (
            <div className={styles.heroTags}>
              {profile.game_tags.map(g => <span key={g} className={styles.heroTag}>{g}</span>)}
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className={styles.body}>

        {/* Follow / CTA row */}
        <div className={styles.socialRow}>
          <div className={styles.followStats}>
            <div className={styles.followStat}>
              <strong>{followStats.followers}</strong>
              <span>Followers</span>
            </div>
            <div className={styles.followDivider} />
            <div className={styles.followStat}>
              <strong>{followStats.following}</strong>
              <span>Following</span>
            </div>
          </div>
          <div className={styles.ctaButtons}>
            {isPartner && (
              <Link href="/partner" className={styles.partnerHubBtn}>
                <i className="ri-shield-star-fill" /> Hub
              </Link>
            )}
            {isAdmin && (
              <Link href="/dashboard" className={styles.adminBtn}>
                <i className="ri-shield-line" /> Admin
              </Link>
            )}
          </div>
        </div>

        {/* Bio */}
        {profile?.bio && <p className={styles.bio}>{profile.bio}</p>}

        {/* Stats bar */}
        <div className={styles.statsBar} style={{ borderColor: theme.border }}>
          {[
            { icon: 'ri-trophy-line',      color: theme.primary, label: 'Wins',    value: profile?.wins    ?? 0 },
            { icon: 'ri-close-circle-line',color: '#94a3b8',     label: 'Losses',  value: profile?.losses  ?? 0 },
            { icon: 'ri-line-chart-line',  color: '#06b6d4',     label: 'Win Rate',value: winRate },
            { icon: 'ri-coins-line',       color: '#f59e0b',     label: 'Points',  value: (profile?.points ?? 0).toLocaleString() },
          ].map(s => (
            <div key={s.label} className={styles.statItem}>
              <i className={s.icon} style={{ color: s.color }} />
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Achievements pills */}
        {achievements.length > 0 && (
          <div className={styles.achievementsScroll}>
            {achievements.map(a => (
              <div key={a.id} className={styles.achievementPill}>
                <i className={a.icon} style={{ color: theme.primary }} />
                {a.label}
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className={styles.tabs}>
          {[
            { key: 'posts',   icon: 'ri-file-text-line',  label: 'Posts'   },
            { key: 'shop',    icon: 'ri-store-2-line',     label: 'Shop'    },
            { key: 'history', icon: 'ri-history-line',     label: 'Seasons' },
          ].map(t => (
            <button
              key={t.key}
              className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <i className={t.icon} />
              {t.label}
              <span className={styles.tabCount}>{tabCounts[t.key]}</span>
            </button>
          ))}
        </div>

        {/* ── Tab: Posts ── */}
        {activeTab === 'posts' && (
          posts.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="ri-quill-pen-line" />
              <p>No posts yet</p>
              <Link href="/feed" className={styles.emptyStateBtn}>
                <i className="ri-add-line" /> Write a post
              </Link>
            </div>
          ) : (
            <div className={styles.postList}>
              {posts.map(p => (
                <div key={p.id} className={styles.postCard}>
                  <div className={styles.postHeader}>
                    <div className={styles.postAvatar}>
                      {profile?.avatar_url
                        ? <img src={profile.avatar_url} alt="" />
                        : initials
                      }
                    </div>
                    <div className={styles.postMeta}>
                      <div className={styles.postUserRow}>
                        <span className={styles.postUser}>{profile?.username}</span>
                      </div>
                      <span className={styles.postTime}>{fmtDate(p.created_at)}</span>
                    </div>
                    <button className={styles.deleteBtn} onClick={() => deletePost(p.id)}>
                      <i className="ri-delete-bin-line" />
                    </button>
                  </div>
                  <p className={styles.postContent}>{p.text}</p>
                  <div className={styles.postActions}>
                    <span className={styles.actionBtn}>
                      <i className="ri-heart-line" /> {p.like_count || 0}
                    </span>
                    <span className={styles.actionBtn}>
                      <i className="ri-chat-1-line" /> {p.comment_count || 0}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ── Tab: Shop ── */}
        {activeTab === 'shop' && (
          shopItems.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="ri-store-2-line" />
              <p>No active listings</p>
              <Link href="/shop" className={styles.emptyStateBtn}>
                <i className="ri-add-line" /> List an item
              </Link>
            </div>
          ) : (
            <>
              <div className={styles.shopGrid}>
                {shopItems.map(item => {
                  const img = item.images?.[0]?.url
                  return (
                    <Link key={item.id} href={`/shop/${item.id}`} className={styles.shopCard}>
                      {img
                        ? <img src={img} className={styles.shopCardImg} alt="" />
                        : <div className={styles.shopCardNoImg}><i className="ri-image-line" /></div>
                      }
                      <div className={styles.shopCardBody}>
                        <span className={styles.shopCategory}>{item.category || 'Item'}</span>
                        <span className={styles.shopTitle}>{item.title}</span>
                        <span className={styles.shopPrice}>{fmtAmt(Number(String(item.price).replace(/[^0-9.]/g, '')))}</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
              <Link href="/shop" className={styles.shopViewAll}>
                View all listings <i className="ri-arrow-right-s-line" />
              </Link>
            </>
          )
        )}

        {/* ── Tab: Season History ── */}
        {activeTab === 'history' && (
          history.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="ri-history-line" />
              <p>No season history yet</p>
            </div>
          ) : (
            <div className={styles.historyList}>
              {history.map(h => (
                <div key={h.id} className={styles.historyRow}>
                  <span className={styles.historySeason}>Season {h.season_number}</span>
                  <span className={styles.historyRank}>#{h.final_rank}</span>
                  <span className={styles.historyTier}
                    style={{ color: (RANK_META[h.tier] || RANK_META.Gold).color }}
                  >{h.tier}</span>
                  <span className={styles.historyPts}>{h.points.toLocaleString()} PTS</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Avatar zoom lightbox ── */}
      {zoomedAvatar && profile?.avatar_url && (
        <div className={styles.lightbox} onClick={() => setZoomedAvatar(false)}>
          <button className={styles.lightboxClose}><i className="ri-close-line" /></button>
          <img src={profile.avatar_url} className={styles.lightboxImg} alt="" />
          <button className={styles.lightboxChangeBtn} onClick={e => { e.stopPropagation(); setZoomedAvatar(false); fileRef.current?.click() }}>
            <i className="ri-camera-line" /> Change Photo
          </button>
        </div>
      )}

      {/* ── Edit Profile Modal ── */}
      <Modal
        open={editModal}
        onClose={() => { setEditModal(false); setSaveError('') }}
        title="Edit Profile"
        size="sm"
        footer={
          <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
            {saveError && <p style={{ color:'#ef4444', fontSize:'0.8rem' }}>{saveError}</p>}
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
            <div style={{ display:'flex', gap:8 }}>
              {FLAG_OPTIONS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setCountryFlag(prev => prev === f.value ? '' : f.value)}
                  style={{
                    flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:5,
                    padding:'10px 6px',
                    border:`1px solid ${countryFlag === f.value ? 'var(--text)' : 'var(--border-dark)'}`,
                    borderRadius:6,
                    background: countryFlag === f.value ? 'var(--surface)' : 'var(--bg-2)',
                    color: countryFlag === f.value ? 'var(--text)' : 'var(--text-muted)',
                    fontSize:11, fontWeight:600, cursor:'pointer', transition:'all 0.15s',
                  }}
                >
                  <img src={`/${f.value}.png`} alt={f.label} style={{ width:22, height:22, borderRadius:3 }} />
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.editField}>
            <label>Phone Number</label>
            <div style={{ display:'flex', gap:6 }}>
              {[
                { code:'254', flag:'/kenya.png',        label:'+254' },
                { code:'255', flag:'/tanzania.png',     label:'+255' },
                { code:'256', flag:'/uganda.png',       label:'+256' },
                { code:'27',  flag:'/south-africa.png', label:'+27'  },
                { code:'234', flag:'/nigeria.png',      label:'+234' },
              ].map(c => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setPhoneCode(c.code)}
                  style={{
                    flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                    padding:'7px 8px', borderRadius:4,
                    border:`1px solid ${phoneCode === c.code ? 'var(--text)' : 'var(--border-dark)'}`,
                    background: phoneCode === c.code ? 'var(--surface)' : 'var(--bg-2)',
                    color: phoneCode === c.code ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight:700, fontSize:11, cursor:'pointer', transition:'all 0.15s',
                  }}
                >
                  <img src={c.flag} alt={c.code} style={{ width:16, height:16, borderRadius:2, objectFit:'cover' }} />
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{
              display:'flex', alignItems:'center', gap:8,
              border:`1px solid ${phoneError ? '#ef4444' : 'var(--border-dark)'}`,
              borderRadius:4, background:'var(--bg-2)', padding:'0 12px',
            }}>
              <span style={{ color:'var(--text-muted)', fontSize:13, fontWeight:700, flexShrink:0 }}>+{phoneCode}</span>
              <div style={{ width:1, height:16, background:'var(--border-dark)', flexShrink:0 }} />
              <input
                type="tel"
                placeholder="712 345 678"
                value={phoneLocal}
                onChange={e => { setPhoneLocal(e.target.value); setPhoneError('') }}
                style={{
                  flex:1, border:'none', background:'transparent',
                  padding:'10px 0', fontSize:13, color:'var(--text)',
                  outline:'none', fontFamily:'var(--font)',
                }}
              />
              {phoneLocal.trim() && (
                <button type="button" onClick={() => { setPhoneLocal(''); setPhoneError('') }}
                  style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:0, fontSize:14 }}>
                  <i className="ri-close-line" />
                </button>
              )}
            </div>
            {phoneError && (
              <p style={{ fontSize:11, color:'#ef4444', margin:0, display:'flex', alignItems:'center', gap:4 }}>
                <i className="ri-error-warning-line" /> {phoneError}
              </p>
            )}
            <p style={{ fontSize:11, color:'var(--text-muted)', margin:0 }}>Used for match confirmations and payouts only.</p>
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
