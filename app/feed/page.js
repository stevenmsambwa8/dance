'use client'
import { useState, useEffect, useRef } from 'react'
import Modal from '../../components/Modal'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import UserBadges from '../../components/UserBadges'
import usePageLoading from '../../components/usePageLoading'

export default function Feed() {
  const { user, profile, isAdmin } = useAuth()
  const [posts, setPosts] = useState([])
  const [liked, setLiked] = useState({})
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [comments, setComments] = useState([])
  const [newPost, setNewPost] = useState('')
  const [postModal, setPostModal] = useState(false)
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)
  const [submitting, setSubmitting] = useState(false)
  const [postError, setPostError] = useState('')
  const textareaRef = useRef(null)

  useEffect(() => { loadPosts() }, [])

  async function loadPosts() {
    setLoading(true)
    const { data, error } = await supabase
      .from('posts')
      .select('id, user_id, content, likes, comment_count, created_at, profiles(id, username, tier, level, avatar_url, email)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!error) setPosts(data || [])
    setLoading(false)
  }

  async function openPost(post) {
    setSelected(post)
    const { data } = await supabase
      .from('comments')
      .select('id, post_id, user_id, text, created_at, profiles(username, avatar_url)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
    setComments(data || [])
  }

  async function toggleLike(post) {
    if (!user) return alert('Log in to like posts')
    const isLiked = liked[post.id]
    setLiked(l => ({ ...l, [post.id]: !isLiked }))
    const newLikes = post.likes + (isLiked ? -1 : 1)
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

  async function submitPost() {
    if (!newPost.trim()) return
    if (!user) { setPostError('You must be logged in to post.'); return }
    setPostError('')
    setSubmitting(true)
    const { data, error } = await supabase
      .from('posts')
      .insert({ user_id: user.id, content: newPost.trim(), likes: 0, comment_count: 0 })
      .select('id, user_id, content, likes, comment_count, created_at, profiles(id, username, tier, level, avatar_url, email)')
      .single()
    if (error) {
      setPostError(error.message)
    } else if (data) {
      setPosts(p => [data, ...p])
      setNewPost('')
      setPostModal(false)
    }
    setSubmitting(false)
  }

  useEffect(() => {
    if (!user || posts.length === 0) return
    supabase.from('post_likes').select('post_id').eq('user_id', user.id)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(l => { map[l.post_id] = true })
        setLiked(map)
      })
  }, [user, posts.length])

  const ADMIN_EMAIL = 'stevenmsambwa8@gmail.com'

  function isPostVerified(post) {
    return post.profiles?.email === ADMIN_EMAIL
  }

  return (
    <div className={styles.page}>
      {user ? (
        <div className={styles.composeBar} onClick={() => setPostModal(true)}>
          <div className={styles.composeAvatar}>
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt="" className={styles.avatarImg} />
              : <span>{(profile?.username || 'P').slice(0, 2).toUpperCase()}</span>
            }
          </div>
          <span className={styles.composePlaceholder}>What&apos;s on your mind, {profile?.username || 'Player'}?</span>
          <button className={styles.composeBtn}><i className="ri-arrow-down-line" /></button>
        </div>
      ) : (
        <p className={styles.loginPrompt}><a href="/login">Log in</a> to post and interact.</p>
      )}

      {!loading && (
        <div className={styles.feed}>
          {posts.length === 0 && <p className={styles.empty}>No posts yet. Be the first!</p>}
          {posts.map(post => (
            <div key={post.id} className={styles.post}>
              <div className={styles.postHeader}>
                <a href={`/profile/${post.profiles?.id}`} className={styles.avatarLink}>
                  <div className={styles.avatar}>
                    {post.profiles?.avatar_url
                      ? <img src={post.profiles.avatar_url} alt="" className={styles.avatarImg} />
                      : <span>{(post.profiles?.username || 'P').slice(0, 2).toUpperCase()}</span>
                    }
                  </div>
                </a>
                <div className={styles.postMeta}>
                  <div className={styles.postUserRow}>
                    <a href={`/profile/${post.profiles?.id}`} className={styles.postUser}>{post.profiles?.username || 'Player'}</a>
                    <UserBadges email={post.profiles?.email} countryFlag={post.profiles?.country_flag} isSeasonWinner={post.profiles?.is_season_winner} size={13} gap={2} />
                  </div>
                  <span className={styles.postRank}>
                    {post.profiles?.level ? `Lv.${post.profiles.level} · ` : ''}{timeAgo(post.created_at)}
                  </span>
                </div>
                {user && (user.id === post.user_id || isAdmin) && (
                  <button className={styles.deleteBtn} onClick={() => deletePost(post)} title="Delete post">
                    <i className="ri-delete-bin-line" />
                  </button>
                )}
              </div>
              <p className={styles.postContent}>{post.content}</p>
              <div className={styles.postActions}>
                <button className={`${styles.action} ${liked[post.id] ? styles.liked : ''}`} onClick={() => toggleLike(post)}>
                  <i className={liked[post.id] ? 'ri-heart-fill' : 'ri-heart-line'} />
                  {post.likes || 0}
                </button>
                <button className={styles.action} onClick={() => openPost(post)}>
                  <i className="ri-chat-1-line" />
                  {post.comment_count || 0}
                </button>
                <button className={styles.action} onClick={() => navigator.share?.({ text: post.content })}>
                  <i className="ri-share-forward-line" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Log in to comment</p>
        }
      >
        {selected && (
          <div className={styles.commentBody}>
            <p className={styles.modalPost}>{selected.content}</p>
            <div className={styles.comments}>
              {comments.length === 0 && <p className={styles.noComments}>No comments yet.</p>}
              {comments.map((c) => (
                <div key={c.id} className={styles.comment}>
                  <span className={styles.commentUser}>{c.profiles?.username || 'Player'}</span>
                  <span className={styles.commentText}>{c.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* New Post Modal */}
      <Modal
        open={postModal}
        onClose={() => { setPostModal(false); setPostError('') }}
        title="New Post"
        size="md"
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            {postError && <p style={{ color: '#ef4444', fontSize: '0.8rem' }}>{postError}</p>}
            <button onClick={submitPost} disabled={submitting || !newPost.trim()} style={{ padding: '10px 20px', background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, opacity: submitting || !newPost.trim() ? 0.5 : 1 }}>
              {submitting ? 'Posting…' : 'Post'} <i className="ri-send-plane-line" />
            </button>
          </div>
        }
      >
        <textarea
          ref={textareaRef}
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: 12, fontSize: '0.9rem', resize: 'vertical', fontFamily: 'inherit', outline: 'none', minHeight: 100 }}
          value={newPost}
          onChange={e => setNewPost(e.target.value)}
          placeholder={`What's on your mind, ${profile?.username || 'Player'}?`}
          rows={5}
          autoFocus
        />
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
