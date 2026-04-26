// updated 1777218303
'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Modal from '../../../components/Modal'
import { useAuth, isHelpdeskEmail } from '../../../components/AuthProvider'
import { getTierTheme } from '../../../lib/tierTheme'
import { supabase } from '../../../lib/supabase'
import styles from './page.module.css'
import UserBadges from '../../../components/UserBadges'
import usePageLoading from '../../../components/usePageLoading'
import { GAME_META, GAME_SLUGS } from '../../../lib/constants'
import { RANK_TIERS, RANK_META } from '../../../lib/constants'

const ALL_GAMES = GAME_SLUGS.map(s => GAME_META[s].name)
const PLAY_STYLES = ['Aggressive', 'Defensive', 'Support', 'Sniper', 'All-Round']
const FLAG_OPTIONS = [
  { value: 'kenya',    label: 'Kenya' },
  { value: 'tanzania', label: 'Tanzania' },
  { value: 'uganda',   label: 'Uganda' },
]

export default function PublicProfile() {
  const { id } = useParams()
  const router = useRouter()
  const { user, profile: myProfile, isAdmin } = useAuth()

  const [profile, setProfile]             = useState(null)
  const [loading, setLoading]             = useState(true)
  usePageLoading(loading)
  const [following, setFollowing]         = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [stats, setStats]                 = useState({ followers: 0, following: 0 })
  const [posts, setPosts]                 = useState([])
  const [liked, setLiked]                 = useState({})
  const [achievements, setAchievements]   = useState([])
  const [shopItems, setShopItems]         = useState([])
  const [shopLoading, setShopLoading]     = useState(true)
  const [activeTab, setActiveTab]         = useState('posts')
  const [zoomedAvatar, setZoomedAvatar]   = useState(false)

  // Edit profile
  const { updateProfile, uploadAvatar } = useAuth()
  const fileRef = useRef()
  const [editModal, setEditModal]         = useState(false)
  const [editUsername, setEditUsername]   = useState('')
  const [editBio, setEditBio]             = useState('')
  const [editPlayStyle, setEditPlayStyle] = useState('Aggressive')
  const [editGameTags, setEditGameTags]   = useState([])
  const [editFlag, setEditFlag]           = useState('')
  const [editPhoneCode, setEditPhoneCode] = useState('255')
  const [editPhoneLocal, setEditPhoneLocal] = useState('')
  const [editSaving, setEditSaving]       = useState(false)
  const [editError, setEditError]         = useState('')
  const [avatarLoading, setAvatarLoading] = useState(false)

  // Comments modal
  const [selected, setSelected]   = useState(null)
  const [comments, setComments]   = useState([])
  const [comment, setComment]     = useState('')

  useEffect(() => { if (id) loadProfile() }, [id, user])

  async function loadProfile() {
    setLoading(true)
    const [
      { data: prof },
      { count: followersCount },
      { count: followingCount },
      { data: postsData },
      { data: achData },
      { data: shopData },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', id),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', id),
      supabase.from('posts')
        .select('id, user_id, content, likes, comment_count, created_at, profiles(id, username, tier, level, avatar_url, email)')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('achievements').select('*').eq('user_id', id).limit(6),
      supabase.from('shop_items')
        .select('id, title, price, category, active, shop_item_images(url, sort_order)')
        .eq('seller_id', id)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(6),
    ])

    setProfile(prof)
    setStats({ followers: followersCount || 0, following: followingCount || 0 })
    setPosts(postsData || [])
    setAchievements(achData || [])
    setShopItems(shopData || [])
    setShopLoading(false)

    if (prof) {
      setEditUsername(prof.username || '')
      setEditBio(prof.bio || '')
      setEditPlayStyle(prof.play_style || 'Aggressive')
      setEditGameTags(prof.game_tags || [])
      setEditFlag(prof.country_flag || '')
      if (prof.phone) {
        const CODES = ['254', '255', '256']
        const stripped = prof.phone.replace(/^\+/, '')
        const matched = CODES.find(c => stripped.startsWith(c))
        setEditPhoneCode(matched || '255')
        setEditPhoneLocal(matched ? stripped.slice(matched.length) : stripped)
      }
    }

    if (user && user.id !== id) {
      const { data: followRow } = await supabase
        .from('follows').select('follower_id')
        .eq('follower_id', user.id).eq('following_id', id).maybeSingle()
      setFollowing(!!followRow)
    }

    if (user && postsData?.length) {
      const postIds = postsData.map(p => p.id)
      const { data: likeRows } = await supabase
        .from('post_likes').select('post_id')
        .eq('user_id', user.id).in('post_id', postIds)
      if (likeRows) {
        const map = {}
        likeRows.forEach(l => { map[l.post_id] = true })
        setLiked(map)
      }
    }

    setLoading(false)
  }

  async function saveProfile() {
    setEditSaving(true); setEditError('')
    const fullPhone = editPhoneLocal.trim()
      ? `+${editPhoneCode}${editPhoneLocal.trim().replace(/^0/, '')}`
      : null
    try {
      await updateProfile({ username: editUsername, bio: editBio, play_style: editPlayStyle, game_tags: editGameTags, country_flag: editFlag || null, phone: fullPhone })
      setProfile(p => ({ ...p, username: editUsername, bio: editBio, play_style: editPlayStyle, game_tags: editGameTags, country_flag: editFlag || null, phone: fullPhone }))
      setEditModal(false)
    } catch (e) { setEditError(e.message) }
    setEditSaving(false)
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarLoading(true)
    try {
      await uploadAvatar(file)
      const { data } = await supabase.from('profiles').select('avatar_url').eq('id', id).single()
      if (data) setProfile(p => ({ ...p, avatar_url: data.avatar_url }))
    } catch (e) { alert('Upload failed: ' + e.message) }
    setAvatarLoading(false)
  }

  function toggleGameTag(g) {
    setEditGameTags(t => t.includes(g) ? t.filter(x => x !== g) : [...t, g])
  }

  async function toggleFollow() {
    if (!user) return router.push('/login')
    setFollowLoading(true)
    if (following) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', id)
      setStats(s => ({ ...s, followers: Math.max(0, s.followers - 1) }))
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: id })
      setStats(s => ({ ...s, followers: s.followers + 1 }))
    }
    setFollowing(f => !f)
    setFollowLoading(false)
  }

  async function toggleLike(post) {
    if (!user) return router.push('/login')
    const isLiked = liked[post.id]
    setLiked(l => ({ ...l, [post.id]: !isLiked }))
    const newLikes = (post.likes || 0) + (isLiked ? -1 : 1)
    setPosts(p => p.map(x => x.id === post.id ? { ...x, likes: newLikes } : x))
    if (isLiked) {
      await supabase.from('post_likes').delete().eq('post_id', post.id).eq('user_id', user.id)
    } else {
      await supabase.from('post_likes').insert({ post_id: post.id, user_id: user.id })
    }
    await supabase.from('posts').update({ likes: newLikes }).eq('id', post.id)
  }

  async function deletePost(post) {
    if (!user) return
    if (user.id !== post.user_id && !isAdmin) return
    if (!confirm('Delete this post?')) return
    const { error } = await supabase.from('posts').delete().eq('id', post.id)
    if (!error) {
      setPosts(p => p.filter(x => x.id !== post.id))
      if (selected?.id === post.id) setSelected(null)
    }
  }

  async function openComments(post) {
    setSelected(post)
    const { data } = await supabase
      .from('comments')
      .select('id, post_id, user_id, text, created_at, profiles(username, avatar_url)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
    setComments(data || [])
  }

  async function addComment() {
    if (!comment.trim() || !selected || !user) return
    const { data } = await supabase
      .from('comments')
      .insert({ post_id: selected.id, user_id: user.id, text: comment.trim() })
      .select('id, post_id, user_id, text, created_at, profiles(username, avatar_url)')
      .single()
    if (data) setComments(c => [...c, data])
    setPosts(p => p.map(x => x.id === selected.id ? { ...x, comment_count: (x.comment_count || 0) + 1 } : x))
    setComment('')
  }

  if (loading) return null
  if (!profile) return (
    <div className={styles.page}>
      <p style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Player not found.</p>
    </div>
  )

  const isOwnProfile   = user?.id === id
  const isHelpdesk     = isHelpdeskEmail(profile.email)
  const initials       = (profile.username || 'P').slice(0, 2).toUpperCase()
  const winRate        = ((profile.wins / Math.max((profile.wins || 0) + (profile.losses || 0), 1)) * 100).toFixed(0) + '%'
  const theme          = getTierTheme(profile.tier)
  const tierMeta       = RANK_META[profile.tier] || RANK_META.Gold

  // ── Helpdesk special profile ──
  if (isHelpdesk) return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => router.back()}>
        <i className="ri-arrow-left-line" /> Back
      </button>
      <div className={styles.helpdeskCard}>
        <div className={styles.helpdeskAvatar}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" />
            : <i className="ri-customer-service-2-line" />
          }
        </div>
        <h1 className={styles.helpdeskName}>
          {profile.username}
          <UserBadges email={profile.email} countryFlag={null} isSeasonWinner={false} size={18} />
        </h1>
        <p className={styles.helpdeskRole}>Nabogaming Help Desk</p>
        <p className={styles.helpdeskBio}>
          {profile.bio || 'Official Nabogaming support account. Reach out for help with your account, matches, or any platform issues.'}
        </p>
        <button
          className={styles.helpdeskBtn}
          onClick={() => user ? router.push('/help-desk') : router.push('/login')}
        >
          <i className="ri-message-3-line" /> Message Support
        </button>
        <p className={styles.helpdeskNote}>Official support account · Not a player profile</p>
      </div>
    </div>
  )

  return (
    <div className={styles.page}>

      {/* ── Header bar ── */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          <i className="ri-arrow-left-line" />
        </button>
        {isOwnProfile && (
          <button className={styles.heroEditBtn} onClick={() => setEditModal(true)}>
            <i className="ri-edit-line" />
          </button>
        )}
      </div>

      {/* ── Profile hero ── */}
      <div className={styles.hero}>
        {/* Avatar */}
        <div
          className={styles.avatarWrap}
          onClick={profile.avatar_url ? () => setZoomedAvatar(true) : (isOwnProfile ? () => fileRef.current?.click() : undefined)}
          style={{ cursor: (isOwnProfile || profile.avatar_url) ? 'pointer' : 'default' }}
        >
          {avatarLoading ? (
            <div className={styles.avatarInner}>
              <i className="ri-loader-4-line" style={{ fontSize: 26, opacity: 0.5 }} />
            </div>
          ) : profile.avatar_url ? (
            <img src={profile.avatar_url} className={styles.avatarImg} alt="" />
          ) : (
            <div className={styles.avatarInner}>{initials}</div>
          )}
          {isOwnProfile && (
            <div className={styles.avatarCamera}><i className="ri-camera-line" /></div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
        </div>

        {/* Name + meta */}
        <div className={styles.heroMeta}>
          <div className={styles.heroNameRow}>
            <h1 className={styles.heroName}>{profile.username}</h1>
            <UserBadges
              email={profile.email}
              countryFlag={profile.country_flag}
              isSeasonWinner={profile.is_season_winner}
              size={20}
            />
          </div>

          {/* Tier badge + play style */}
          <div className={styles.heroSubRow}>
            <span
              className={styles.tierBadge}
              style={{ color: tierMeta.color, borderColor: tierMeta.color + '55', background: tierMeta.color + '18' }}
            >
              <i className={tierMeta.icon} />
              {profile.tier || 'Gold'}
            </span>
            <span className={styles.heroDot}>·</span>
            <span className={styles.heroLevel}>Lv.{profile.level ?? 1}</span>
            {profile.play_style && (
              <>
                <span className={styles.heroDot}>·</span>
                <span className={styles.heroPlayStyle}>{profile.play_style}</span>
              </>
            )}
          </div>

          {/* Game tags */}
          {(profile.game_tags || []).length > 0 && (
            <div className={styles.heroTags}>
              {profile.game_tags.map(g => (
                <span key={g} className={styles.heroTag}>{g}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Avatar zoom lightbox ── */}
      {zoomedAvatar && profile.avatar_url && (
        <div className={styles.lightbox} onClick={() => setZoomedAvatar(false)}>
          <img src={profile.avatar_url} className={styles.lightboxImg} alt={profile.username} onClick={e => e.stopPropagation()} />
          {isOwnProfile && (
            <button className={styles.lightboxChangeBtn} onClick={e => { e.stopPropagation(); setZoomedAvatar(false); fileRef.current?.click() }}>
              <i className="ri-camera-line" /> Change Photo
            </button>
          )}
          <button className={styles.lightboxClose} onClick={() => setZoomedAvatar(false)}>
            <i className="ri-close-line" />
          </button>
        </div>
      )}
      <div className={styles.body}>

        {/* ── Social stats + CTA row ── */}
        <div className={styles.socialRow}>
          <div className={styles.followStats}>
            <button className={styles.followStat} onClick={() => {}}>
              <strong>{stats.followers.toLocaleString()}</strong>
              <span>Followers</span>
            </button>
            <div className={styles.followDivider} />
            <button className={styles.followStat} onClick={() => {}}>
              <strong>{stats.following.toLocaleString()}</strong>
              <span>Following</span>
            </button>
          </div>

          <div className={styles.ctaButtons}>
            {!isOwnProfile ? (
              <>
                <button
                  className={`${styles.followBtn} ${following ? styles.followingBtn : ''}`}
                  onClick={toggleFollow}
                  disabled={followLoading}
                >
                  {following ? <i className="ri-check-line" /> : 'Follow'}
                </button>
                <button
                  className={styles.msgBtn}
                  onClick={() => user
                    ? (isHelpdeskEmail(profile?.email) ? router.push('/help-desk') : router.push(`/dm/${id}`))
                    : router.push('/login')
                  }
                >
                  <i className="ri-message-3-line" />
                </button>
                <button
                  className={styles.msgBtn}
                  onClick={() => navigator.share?.({ title: profile.username, url: window.location.href })
                    ?? navigator.clipboard?.writeText(window.location.href)}
                >
                  <i className="ri-share-forward-line" />
                </button>
              </>
            ) : (
              <button className={styles.editProfileBtn} onClick={() => setEditModal(true)}>
                Edit Profile
              </button>
            )}
          </div>
        </div>

        {/* ── Bio ── */}
        {profile.bio && (
          <p className={styles.bio}>{profile.bio}</p>
        )}

        {/* ── Stats bar ── */}
        <div className={styles.statsBar}>
          {[
            { icon: 'ri-sword-line',       label: 'Wins',     value: profile.wins ?? 0 },
            { icon: 'ri-close-circle-line', label: 'Losses',   value: profile.losses ?? 0 },
            { icon: 'ri-percent-line',      label: 'Win Rate', value: winRate },
            { icon: 'ri-star-line',         label: 'Points',   value: (profile.points || 0).toLocaleString() },
          ].map(s => (
            <div key={s.label} className={styles.statItem}>
              <i className={s.icon} style={{ color: theme.primary }} />
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {/* ── Achievements ── */}
        {achievements.length > 0 && (
          <div className={styles.achievementsScroll}>
            {achievements.map(a => (
              <div key={a.id} className={styles.achievementPill}>
                <i className={a.icon || 'ri-trophy-line'} style={{ color: theme.primary }} />
                <span>{a.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Tab bar ── */}
        <div className={styles.tabs}>
          {[
            { key: 'posts', label: 'Posts', count: posts.length },
            { key: 'shop',  label: 'Shop',  count: shopItems.length },
          ].map(t => (
            <button
              key={t.key}
              className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
              {t.count > 0 && <span className={styles.tabCount}>{t.count}</span>}
            </button>
          ))}
        </div>

        {/* ── Tab: Posts ── */}
        {activeTab === 'posts' && (
          <div className={styles.postList}>
            {posts.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="ri-quill-pen-line" />
                <p>No posts yet</p>
              </div>
            ) : posts.map(post => (
              <div key={post.id} className={styles.postCard}>
                <div className={styles.postHeader}>
                  <Link href={`/profile/${post.profiles?.id}`} className={styles.postAvatar}>
                    {post.profiles?.avatar_url
                      ? <img src={post.profiles.avatar_url} alt="" />
                      : <span>{(post.profiles?.username || 'P').slice(0, 2).toUpperCase()}</span>
                    }
                  </Link>
                  <div className={styles.postMeta}>
                    <div className={styles.postUserRow}>
                      <Link href={`/profile/${post.profiles?.id}`} className={styles.postUser}>
                        {post.profiles?.username || 'Player'}
                      </Link>
                      <UserBadges
                        email={post.profiles?.email}
                        countryFlag={post.profiles?.country_flag}
                        isSeasonWinner={post.profiles?.is_season_winner}
                        size={12}
                        gap={2}
                      />
                    </div>
                    <span className={styles.postTime}>
                      {post.profiles?.level ? `Lv.${post.profiles.level} · ` : ''}{timeAgo(post.created_at)}
                    </span>
                  </div>
                  {user && (user.id === post.user_id || isAdmin) && (
                    <button className={styles.deleteBtn} onClick={() => deletePost(post)}>
                      <i className="ri-delete-bin-line" />
                    </button>
                  )}
                </div>

                <p className={styles.postContent}>{post.content}</p>

                <div className={styles.postActions}>
                  <button
                    className={`${styles.actionBtn} ${liked[post.id] ? styles.liked : ''}`}
                    onClick={() => toggleLike(post)}
                  >
                    <i className={liked[post.id] ? 'ri-heart-fill' : 'ri-heart-line'} />
                    <span>{post.likes || 0}</span>
                  </button>
                  <button className={styles.actionBtn} onClick={() => openComments(post)}>
                    <i className="ri-chat-1-line" />
                    <span>{post.comment_count || 0}</span>
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={() => navigator.share?.({ text: post.content })}
                  >
                    <i className="ri-share-forward-line" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: Shop ── */}
        {activeTab === 'shop' && (
          <div>
            {!shopLoading && shopItems.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="ri-store-2-line" />
                <p>{profile.username} doesn&apos;t sell anything yet</p>
                <Link href="/shop" className={styles.emptyStateBtn}>
                  Browse Shop
                </Link>
              </div>
            ) : (
              <>
                <div className={styles.shopGrid}>
                  {shopItems.map(item => {
                    const img = item.shop_item_images?.sort((a, b) => a.sort_order - b.sort_order)[0]?.url
                    return (
                      <Link key={item.id} href={`/shop/${item.id}`} className={styles.shopCard}>
                        {img
                          ? <img src={img} alt={item.title} className={styles.shopCardImg} />
                          : <div className={styles.shopCardNoImg}><i className="ri-image-line" /></div>
                        }
                        <div className={styles.shopCardBody}>
                          <span className={styles.shopCategory}>{item.category}</span>
                          <span className={styles.shopTitle}>{item.title}</span>
                          <span className={styles.shopPrice}>
                            TZS {isNaN(Number(String(item.price).replace(/,/g, '')))
                              ? item.price
                              : Number(String(item.price).replace(/,/g, '')).toLocaleString()}
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
                <Link href="/shop" className={styles.shopViewAll}>
                  View all in Shop <i className="ri-arrow-right-line" />
                </Link>
              </>
            )}
          </div>
        )}

      </div>

      {/* ── Edit Profile Modal ── */}
      {isOwnProfile && (
        <Modal
          open={editModal}
          onClose={() => { setEditModal(false); setEditError('') }}
          title="Edit Profile"
          size="sm"
          footer={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {editError && <p style={{ color: '#ef4444', fontSize: '0.8rem' }}>{editError}</p>}
              <button className={styles.saveBtn} onClick={saveProfile} disabled={editSaving}>
                <i className="ri-check-line" /> {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          }
        >
          <div className={styles.editForm}>
            <div className={styles.editField}>
              <label>Username</label>
              <input value={editUsername} onChange={e => setEditUsername(e.target.value)} />
            </div>
            <div className={styles.editField}>
              <label>Bio</label>
              <textarea rows={3} value={editBio} onChange={e => setEditBio(e.target.value)} placeholder="Tell other players about yourself..." />
            </div>
            <div className={styles.editField}>
              <label>Play Style</label>
              <select value={editPlayStyle} onChange={e => setEditPlayStyle(e.target.value)}>
                {PLAY_STYLES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className={styles.editField}>
              <label>Country</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {FLAG_OPTIONS.map(f => (
                  <button key={f.value} type="button"
                    onClick={() => setEditFlag(prev => prev === f.value ? '' : f.value)}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                      padding: '10px 6px', borderRadius: 6,
                      border: `1px solid ${editFlag === f.value ? 'var(--text)' : 'var(--border-dark)'}`,
                      background: editFlag === f.value ? 'var(--surface)' : 'var(--bg-2)',
                      color: editFlag === f.value ? 'var(--text)' : 'var(--text-muted)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                    <img src={`/${f.value}.png`} alt={f.label} style={{ width: 22, height: 22, borderRadius: 3 }} />
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.editField}>
              <label>Phone Number</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                {[
                  { code: '254', flag: '/kenya.png',    label: '+254' },
                  { code: '255', flag: '/tanzania.png', label: '+255' },
                  { code: '256', flag: '/uganda.png',   label: '+256' },
                ].map(c => (
                  <button key={c.code} type="button" onClick={() => setEditPhoneCode(c.code)} style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    padding: '7px 8px', borderRadius: 4,
                    border: `1px solid ${editPhoneCode === c.code ? 'var(--text)' : 'var(--border-dark)'}`,
                    background: editPhoneCode === c.code ? 'var(--surface)' : 'var(--bg-2)',
                    color: editPhoneCode === c.code ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: 700, fontSize: 11, cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                    <img src={c.flag} alt={c.code} style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                    {c.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border-dark)', borderRadius: 4, background: 'var(--bg-2)', padding: '0 12px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>+{editPhoneCode}</span>
                <div style={{ width: 1, height: 16, background: 'var(--border-dark)', flexShrink: 0 }} />
                <input
                  type="tel" placeholder="712 345 678" value={editPhoneLocal}
                  onChange={e => setEditPhoneLocal(e.target.value)}
                  style={{ flex: 1, border: 'none', background: 'transparent', padding: '10px 0', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'var(--font)' }}
                />
                {editPhoneLocal && (
                  <button type="button" onClick={() => setEditPhoneLocal('')}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: 14 }}>
                    <i className="ri-close-line" />
                  </button>
                )}
              </div>
            </div>
            <div className={styles.editField}>
              <label>Game Tags</label>
              <div className={styles.gameTagGrid}>
                {ALL_GAMES.map(g => (
                  <button key={g} type="button"
                    className={`${styles.gameTagBtn} ${editGameTags.includes(g) ? styles.gameTagActive : ''}`}
                    onClick={() => toggleGameTag(g)}>{g}</button>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Comments Modal ── */}
      <Modal
        open={!!selected}
        onClose={() => { setSelected(null); setComment('') }}
        title={selected ? `${selected.profiles?.username || 'Player'}'s post` : ''}
        size="md"
        footer={
          user ? (
            <div className={styles.commentInput}>
              <input
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addComment()}
                placeholder="Write a comment..."
              />
              <button onClick={addComment}><i className="ri-send-plane-fill" /></button>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <Link href="/login">Log in</Link> to comment
            </p>
          )
        }
      >
        {selected && (
          <div className={styles.commentBody}>
            <p className={styles.modalPost}>{selected.content}</p>
            <div className={styles.commentsWrap}>
              {comments.length === 0 && <p className={styles.noComments}>No comments yet.</p>}
              {comments.map(c => (
                <div key={c.id} className={styles.comment}>
                  <span className={styles.commentUser}>{c.profiles?.username || 'Player'}</span>
                  <span className={styles.commentText}>{c.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
