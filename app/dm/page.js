'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth, isHelpdeskEmail } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { useOnlineUsers } from '../../lib/usePresence'
import styles from './page.module.css'

function timeAgo(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function DMListPage() {
  const { user } = useAuth()
  const router = useRouter()
  const onlineIds = useOnlineUsers()
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!user) return
    loadThreads()
  }, [user])

  async function loadThreads() {
    setLoading(true)

    // Get all messages where user is sender or receiver, grouped by thread
    const { data: msgs } = await supabase
      .from('direct_messages')
      .select('thread_id, sender_id, receiver_id, body, created_at')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(500)

    if (!msgs) { setLoading(false); return }

    // Dedupe — keep latest message per thread
    const seen = new Map()
    for (const m of msgs) {
      if (!seen.has(m.thread_id)) seen.set(m.thread_id, m)
    }

    // Get the other user's id per thread
    const threadList = [...seen.values()].map(m => ({
      thread_id: m.thread_id,
      other_id: m.sender_id === user.id ? m.receiver_id : m.sender_id,
      last_body: m.body,
      last_at: m.created_at,
    }))

    if (threadList.length === 0) { setThreads([]); setLoading(false); return }

    // Fetch all other users' profiles in one query
    const otherIds = [...new Set(threadList.map(t => t.other_id))]
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, tier')
      .in('id', otherIds)

    const profileMap = {}
    profiles?.forEach(p => { profileMap[p.id] = p })

    // Merge and sort by latest message
    const merged = threadList
      .map(t => ({ ...t, profile: profileMap[t.other_id] || null }))
      .filter(t => t.profile)
      .sort((a, b) => new Date(b.last_at) - new Date(a.last_at))

    setThreads(merged)
    setLoading(false)
  }

  if (!user) return (
    <div className={styles.page}>
      <div className={styles.empty}>
        <i className="ri-lock-line" />
        <p>Log in to see messages</p>
        <Link href="/login" className={styles.loginBtn}>Log In</Link>
      </div>
    </div>
  )

  const filtered = threads.filter(t =>
    !search || t.profile?.username?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Private</p>
          <h1 className={styles.headline}>Messages</h1>
        </div>
      </div>

      <div className={styles.searchWrap}>
        <i className="ri-search-line" />
        <input
          className={styles.searchInput}
          placeholder="Search conversations…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? null : filtered.length === 0 ? (
        <div className={styles.empty}>
          <i className="ri-chat-3-line" />
          <p>{search ? 'No conversations match.' : 'No messages yet.'}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map(t => {
            const isOnline = onlineIds.has(t.other_id)
            const isHD = isHelpdeskEmail(t.profile?.email)
            return (
              <button
                key={t.thread_id}
                className={styles.threadRow}
                onClick={() => router.push(isHD ? '/help-desk' : `/dm/${t.other_id}`)}
                style={isHD ? { borderLeft: '3px solid var(--accent)', background: 'var(--card)' } : {}}
              >
                <div className={styles.avatarWrap}>
                  <div className={styles.avatar} style={isHD ? { background: 'var(--accent)', border: '2px solid var(--accent)' } : {}}>
                    {t.profile.avatar_url
                      ? <img src={t.profile.avatar_url} alt="" />
                      : isHD
                        ? <i className="ri-customer-service-2-line" style={{ color: '#fff', fontSize: 18 }} />
                        : <span>{(t.profile.username || '?')[0].toUpperCase()}</span>
                    }
                  </div>
                  {!isHD && <span className={`${styles.statusDot} ${isOnline ? styles.online : styles.offline}`} />}
                  {isHD && <span className={styles.statusDot} style={{ background: 'var(--accent)' }} />}
                </div>
                <div className={styles.threadInfo}>
                  <div className={styles.threadTop}>
                    <span className={styles.threadName} style={isHD ? { color: 'var(--accent)' } : {}}>
                      {isHD ? 'Nabogaming Support' : t.profile.username}
                    </span>
                    <span className={styles.threadTime}>{timeAgo(t.last_at)}</span>
                  </div>
                  <p className={styles.threadPreview} style={isHD ? { color: 'var(--accent)', fontWeight: 500 } : {}}>
                    {isHD ? 'Official Help Desk · ' : ''}{t.last_body}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
