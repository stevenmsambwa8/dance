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

const ADMIN_EMAIL = 'stevenmsambwa8@gmail.com'

export default function PublicProfile() {
  const { id } = useParams()
  const router = useRouter()
  const { user, profile: myProfile, isAdmin } = useAuth()

  const [profile, setProfile]         = useState(null)
  const [loading, setLoading]         = useState(true)
  usePageLoading(loading)
  const [following, setFollowing]     = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [stats, setStats]             = useState({ followers: 0, following: 0 })
  const [posts, setPosts]             = useState([])
  const [liked, setLiked]             = useState({})
  const [achievements, setAchievements] = useState([])
  const [shopItems, setShopItems]     = useState([])
  const [shopLoading, setShopLoading] = useState(true)

  // Comments modal
  const [selected, setSelected]       = useState(null)
  const [comments, setComments]       = useState([])
  const [comment, setComment]         = useState('')

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

    if (user && user.id !== id) {
      const { data: followRow } = await supabase
        .from('follows').select('follower_id')
        .eq('follower_id', user.id).eq('following_id', id).maybeSingle()
      setFollowing(!!followRow)
    }

    // Load liked state
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
    const canDelete = user.id === post.user_id || isAdmin
    if (!canDelete) return
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

  const isOwnProfile = user?.id === id
  const initials = (profile.username || 'P').slice(0, 2).toUpperCase()
  const winRate = ((profile.wins / Math.max((profile.wins || 0) + (profile.losses || 0), 1)) * 100).toFixed(0) + '%'
  const isHelpdesk = isHelpdeskEmail(profile.email)
  const theme = getTierTheme(profile.tier)

  if (isHelpdesk) return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => router.back()}>
        <i className="ri-arrow-left-line" /> Back
      </button>
      <div style={{
        margin: '32px 16px',
        borderRadius: 16,
        border: '1px solid var(--border)',
        padding: '32px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
        background: 'var(--card)',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32,
        }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
            : <i className="ri-customer-service-2-line" style={{ color: '#fff' }} />
          }
        </div>
        <div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {profile.username}
            <UserBadges email={profile.email} countryFlag={null} isSeasonWinner={false} size={18} />
          </h1>
          <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.85rem', margin: '4px 0 0', letterSpacing: 1, textTransform: 'uppercase' }}>
            Nabogaming Help Desk
          </p>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6, maxWidth: 280, margin: 0 }}>
          {profile.bio || 'Official Nabogaming support account. Reach out for help with your account, matches, or any platform issues.'}
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button
            onClick={() => user ? router.push('/help-desk') : router.push('/login')}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: '#fff',
              fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <i className="ri-message-3-line" /> Message Support
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 4 }}>
          This is an official support account · Not a player profile
        </p>
      </div>
    </div>
  )

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => router.back()}>
        <i className="ri-arrow-left-line" /> Back
      </button>

      {/* Profile card */}
      <div className={styles.profileCard} style={{
        background: theme.gradient,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        padding: '20px 16px',
        boxShadow: `0 0 0 1px ${theme.border}, 0 4px 24px ${theme.glow}`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div className={styles.avatar}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} className={styles.avatarImg} alt="" style={{ outline: `3px solid ${theme.primary}`, outlineOffset: 2 }} />
            : <span style={{ background: theme.primary, color: '#fff', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit' }}>{initials}</span>
          }
        </div>
        <div className={styles.profileInfo}>
          <h1 className={styles.username}>
            {profile.username}
            <UserBadges email={profile.email} countryFlag={profile.country_flag} isSeasonWinner={profile.is_season_winner} size={18} />
          </h1>
          {!isHelpdesk && (
            <p className={styles.tagline} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className={theme.icon} style={{ color: theme.primary, fontSize: 13 }} />
              <span style={{ color: theme.primary, fontWeight: 700 }}>{profile.tier || 'Gold'}</span>
              <span>· Lv.{profile.level ?? 1} · {profile.play_style || 'Player'}</span>
            </p>
          )}
          {isHelpdesk && <p className={styles.tagline}>Nabogaming Help Desk</p>}
          {(profile.game_tags || []).length > 0 && (
            <div className={styles.gameTags}>
              {profile.game_tags.map(g => <span key={g} className={styles.gameTag}>{g}</span>)}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {!isOwnProfile && (
        <div className={styles.actions}>
          <button
            className={`${styles.followBtn} ${following ? styles.followingBtn : ''}`}
            onClick={toggleFollow}
            disabled={followLoading}
          >
            <i className={following ? 'ri-user-unfollow-line' : 'ri-user-add-line'} />
            {following ? 'Following' : 'Follow'}
          </button>
          <button
            className={styles.msgBtn}
            onClick={() => user ? (isHelpdeskEmail(profile?.email) ? router.push('/help-desk') : router.push(`/dm/${id}`)) : router.push('/login')}
          >
            <i className="ri-message-3-line" />
            Message
          </button>
        </div>
      )}
      {isOwnProfile && (
        <div className={styles.actions}>
          <button className={styles.editBtn} onClick={() => router.push('/account')}>
            <i className="ri-edit-line" /> Edit Profile
          </button>
        </div>
      )}

      {/* Follow stats */}
      <div className={styles.followRow}>
        <div className={styles.followStat}><strong>{stats.followers}</strong><span>Followers</span></div>
        <div className={styles.followStat}><strong>{stats.following}</strong><span>Following</span></div>
      </div>

      {/* Game stats */}
      {!isHelpdesk && <div className={styles.statsRow}>
        {[
          { label: 'Wins',     value: profile.wins   ?? 0 },
          { label: 'Losses',   value: profile.losses ?? 0 },
          { label: 'Win Rate', value: winRate },
          { label: 'Points',   value: (profile.points || 0).toLocaleString() },
        ].map(s => (
          <div key={s.label} className={styles.miniStat}>
            <span className={styles.miniValue}>{s.value}</span>
            <span className={styles.miniLabel}>{s.label}</span>
          </div>
        ))}
      </div>}

      {/* Bio */}
      {profile.bio && (
        <section className={styles.section}>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', lineHeight: 1.6 }}>{profile.bio}</p>
        </section>
      )}

      {/* Achievements */}
      {achievements.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Achievements</h2>
          <div className={styles.achievements}>
            {achievements.map(a => (
              <div key={a.id} className={styles.achievement}>
                <i className={`${a.icon || 'ri-trophy-line'} ${styles.achIcon}`} />
                <span className={styles.achLabel}>{a.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Shop */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Shop</h2>
          {shopItems.length > 0 && (
            <Link href="/shop" className={styles.sectionLink}>
              View all <i className="ri-arrow-right-line" />
            </Link>
          )}
        </div>
        {!shopLoading && shopItems.length === 0 ? (
          <div className={styles.shopEmpty}>
            <i className="ri-store-2-line" />
            <p>{profile.username} doesn&apos;t sell anything yet.</p>
            <Link href="/shop" className={styles.shopEmptyBtn}>
              <i className="ri-store-2-line" /> Go to Shop
            </Link>
          </div>
        ) : (
          <div className={styles.shopGrid}>
            {shopItems.map(item => {
              const img = item.shop_item_images?.sort((a,b) => a.sort_order - b.sort_order)[0]?.url
              return (
              <Link key={item.id} href={`/shop/${item.id}`} className={styles.shopCard}>
                {img
                  ? <img src={img} alt={item.title} className={styles.shopCardImg} />
                  : <div className={styles.shopCardNoImg}><i className="ri-image-line" /></div>
                }
                <div className={styles.shopCardBody}>
                  <span className={styles.shopCategory}>{item.category}</span>
                  <span className={styles.shopTitle}>{item.title}</span>
                  <span className={styles.shopPrice}>TZS {isNaN(Number(String(item.price).replace(/,/g, ''))) ? item.price : Number(String(item.price).replace(/,/g, '')).toLocaleString()}</span>
                </div>
              </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Posts */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Posts ({posts.length})</h2>
        {posts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No posts yet.</p>
        ) : (
          <div className={styles.postList}>
            {posts.map(post => (
              <div key={post.id} className={styles.postCard}>
                {/* Post header */}
                <div className={styles.postHeader}>
                  <Link href={`/profile/${post.profiles?.id}`} className={styles.postAvatarLink}>
                    <div className={styles.postAvatar}>
                      {post.profiles?.avatar_url
                        ? <img src={post.profiles.avatar_url} alt="" className={styles.postAvatarImg} />
                        : <span>{(post.profiles?.username || 'P').slice(0, 2).toUpperCase()}</span>
                      }
                    </div>
                  </Link>
                  <div className={styles.postMeta}>
                    <div className={styles.postUserRow}>
                      <Link href={`/profile/${post.profiles?.id}`} className={styles.postUser}>
                        {post.profiles?.username || 'Player'}
                      </Link>
                      <UserBadges email={post.profiles?.email} countryFlag={post.profiles?.country_flag} isSeasonWinner={post.profiles?.is_season_winner} size={13} gap={2} />
                    </div>
                    <span className={styles.postTime}>
                      {post.profiles?.level ? `Lv.${post.profiles.level} · ` : ''}{timeAgo(post.created_at)}
                    </span>
                  </div>
                  {user && (user.id === post.user_id || isAdmin) && (
                    <button className={styles.deleteBtn} onClick={() => deletePost(post)} title="Delete">
                      <i className="ri-delete-bin-line" />
                    </button>
                  )}
                </div>

                {/* Content */}
                <p className={styles.postContent}>{post.content}</p>

                {/* Actions */}
                <div className={styles.postActions}>
                  <button
                    className={`${styles.action} ${liked[post.id] ? styles.liked : ''}`}
                    onClick={() => toggleLike(post)}
                  >
                    <i className={liked[post.id] ? 'ri-heart-fill' : 'ri-heart-line'} />
                    {post.likes || 0}
                  </button>
                  <button className={styles.action} onClick={() => openComments(post)}>
                    <i className="ri-chat-1-line" />
                    {post.comment_count || 0}
                  </button>
                  <button
                    className={styles.action}
                    onClick={() => navigator.share?.({ text: post.content })}
                  >
                    <i className="ri-share-forward-line" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Comments Modal */}
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
