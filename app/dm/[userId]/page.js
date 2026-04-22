'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../../components/AuthProvider'
import { supabase } from '../../../lib/supabase'
import styles from './page.module.css'

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function formatDay(ts) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function DMPage() {
  const { userId } = useParams()
  const router = useRouter()
  const { user } = useAuth()

  const [otherProfile, setOtherProfile] = useState(null)
  const [myProfile, setMyProfile]       = useState(null)
  const [messages, setMessages]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [msgText, setMsgText]           = useState('')
  const [sending, setSending]           = useState(false)
  const [ctxMenu, setCtxMenu]           = useState(null)

  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)
  const longPressTimer = useRef(null)
  const ctxRef         = useRef(null)

  const threadId = user ? [user.id, userId].sort().join('--') : null

  useEffect(() => {
    if (!user) return
    loadAll()

    const ch = supabase
      .channel('dm--' + threadId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'direct_messages',
        filter: `thread_id=eq.${threadId}`,
      }, payload => {
        supabase
          .from('direct_messages')
          .select('*, sender:profiles!direct_messages_sender_id_fkey(id, username, avatar_url)')
          .eq('id', payload.new.id)
          .single()
          .then(({ data }) => {
            if (!data) return
            setMessages(prev => {
              const optIdx = prev.findIndex(m => m._optimistic && m.body === data.body && m.sender_id === data.sender_id)
              if (optIdx !== -1) { const n = [...prev]; n[optIdx] = data; return n }
              if (prev.find(m => m.id === data.id)) return prev
              return [...prev, data]
            })
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
          })
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'direct_messages',
        filter: `thread_id=eq.${threadId}`,
      }, payload => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id))
      })
      .subscribe()

    return () => supabase.removeChannel(ch)
  }, [user, userId])

  useEffect(() => {
    function handler(e) {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtxMenu(null)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: other }, { data: me }] = await Promise.all([
      supabase.from('profiles').select('id, username, avatar_url, tier, level, online_status').eq('id', userId).single(),
      supabase.from('profiles').select('id, username, avatar_url, tier').eq('id', user.id).single(),
    ])
    setOtherProfile(other || null)
    setMyProfile(me || null)

    const { data: msgs } = await supabase
      .from('direct_messages')
      .select('*, sender:profiles!direct_messages_sender_id_fkey(id, username, avatar_url)')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(300)

    setMessages(msgs || [])
    setLoading(false)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 200)
  }

  async function sendMessage() {
    if (!msgText.trim() || !user || sending) return
    setSending(true)
    const body = msgText.trim()
    setMsgText('')

    const optimistic = {
      id: 'opt-' + Date.now(), _optimistic: true,
      thread_id: threadId, sender_id: user.id, receiver_id: userId,
      body, created_at: new Date().toISOString(),
      sender: myProfile,
    }
    setMessages(prev => [...prev, optimistic])
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)

    const { error: dmError } = await supabase.from('direct_messages').insert({
      thread_id: threadId,
      sender_id: user.id,
      receiver_id: userId,
      body,
    })

    if (dmError) {
      console.error('[DM] insert error:', dmError)
      setMessages(prev => prev.filter(m => m.id !== optimistic.id))
      setMsgText(body)
      setSending(false)
      return
    }

    // Use SECURITY DEFINER function to bypass RLS for cross-user notification
    const senderName = myProfile?.username || user.email?.split('@')[0] || 'Player'
    supabase.rpc('insert_notification', {
      p_user_id: userId,
      p_type: 'direct_message',
      p_title: 'Message from ' + senderName,
      p_body: body.slice(0, 80),
      p_meta: { thread_id: threadId, sender_id: user.id, sender_avatar: myProfile?.avatar_url || null },
    }).then(({ error }) => {
      if (error) console.error('[DM] notification rpc error:', error)
    })

    setSending(false)
    inputRef.current?.focus()
  }

  async function deleteMessage(msg) {
    setCtxMenu(null)
    setMessages(prev => prev.filter(m => m.id !== msg.id))
    await supabase.from('direct_messages').delete().eq('id', msg.id)
  }

  function openCtx(e, msg) {
    e.preventDefault()
    clearTimeout(longPressTimer.current)
    setCtxMenu({ msg, canDelete: msg.sender_id === user?.id })
  }
  function onPointerDown(e, msg) {
    longPressTimer.current = setTimeout(() => openCtx(e, msg), 500)
  }

  if (!user) return (
    <div className={styles.page}>
      <div className={styles.centered}>
        <i className="ri-lock-line" style={{ fontSize: 32, color: 'var(--text-muted)' }} />
        <p>Log in to send messages</p>
        <Link href="/login" className={styles.primaryBtn}>Log In</Link>
      </div>
    </div>
  )

  if (loading) return null

  if (!otherProfile) return (
    <div className={styles.page}>
      <div className={styles.centered}>
        <p>Player not found.</p>
        <button className={styles.primaryBtn} onClick={() => router.back()}>Go Back</button>
      </div>
    </div>
  )

  const statusColor = otherProfile.online_status === 'online' ? '#22c55e'
    : otherProfile.online_status === 'away' ? '#f59e0b' : 'var(--border-dark)'

  return (
    <div className={styles.page}>
      <div className={styles.chatWrap}>

        {/* ── Top bar ── */}
        <div className={styles.topBar}>
          <button className={styles.backBtn} onClick={() => router.back()}>
            <i className="ri-arrow-left-line" />
          </button>
          <Link href={`/profile/${otherProfile.id}`} className={styles.profileLink}>
            <div className={styles.pAvatar}>
              {otherProfile.avatar_url
                ? <img src={otherProfile.avatar_url} alt="" />
                : <span>{(otherProfile.username || '?')[0].toUpperCase()}</span>
              }
              <span className={styles.statusDot} style={{ background: statusColor }} />
            </div>
            <div className={styles.pText}>
              <span className={styles.pName}>{otherProfile.username}</span>
              <span className={`${styles.pSub} ${otherProfile.online_status === 'online' ? styles.pSubOnline : ''}`}>
                {otherProfile.online_status === 'online' ? 'Active Now' :
                 otherProfile.online_status === 'away' ? 'Offline' :
                 otherProfile.tier ? otherProfile.tier + (otherProfile.level ? ` · Lv.${otherProfile.level}` : '') : 'Player'}
              </span>
            </div>
          </Link>
          <Link href={`/profile/${otherProfile.id}`} className={styles.viewBtn} title="View Profile">
            <i className="ri-user-line" />
          </Link>
        </div>

        {/* ── Messages ── */}
        <div className={styles.chatBox}>
          {messages.length === 0 && (
            <div className={styles.chatEmpty}>
              <i className="ri-chat-3-line" />
              <div className={styles.chatEmptyName}>{otherProfile.username}</div>
              <div className={styles.chatEmptyHint}>No messages yet — say something!</div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const mine = msg.sender_id === user?.id
            const prev = messages[idx - 1]
            const next = messages[idx + 1]
            const isLastGroup = !next || next.sender_id !== msg.sender_id
            const msgDate  = new Date(msg.created_at).toDateString()
            const prevDate = prev ? new Date(prev.created_at).toDateString() : null
            const showDay  = idx === 0 || msgDate !== prevDate

            return (
              <div key={msg.id}>
                {showDay && (
                  <div className={styles.dayDivider}>
                    <span>{formatDay(msg.created_at)}</span>
                  </div>
                )}
                <div className={`${styles.msgRow} ${mine ? styles.mine : styles.theirs} ${msg._optimistic ? styles.optimistic : ''}`}>
                  {!mine && (
                    <div className={styles.avatarCol}>
                      {isLastGroup
                        ? <div className={styles.msgAvatar}>
                            {otherProfile.avatar_url ? <img src={otherProfile.avatar_url} alt="" /> : <span>{(otherProfile.username || '?')[0].toUpperCase()}</span>}
                          </div>
                        : <div className={styles.avatarSpacer} />
                      }
                    </div>
                  )}
                  <div className={styles.msgContent}>
                    <div
                      className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleTheirs} ${isLastGroup ? (mine ? styles.lastMine : styles.lastTheirs) : ''}`}
                      onPointerDown={e => onPointerDown(e, msg)}
                      onPointerUp={() => clearTimeout(longPressTimer.current)}
                      onPointerLeave={() => clearTimeout(longPressTimer.current)}
                      onContextMenu={e => openCtx(e, msg)}
                    >
                      <span className={styles.bubbleText}>{msg.body}</span>
                      <span className={styles.bubbleMeta}>
                        <span className={styles.bubbleTime}>{formatTime(msg.created_at)}</span>
                        {mine && <i className="ri-check-double-line" style={{ fontSize: 11, opacity: 0.55 }} />}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Input ── */}
        <div className={styles.inputArea}>
          <div className={styles.inputWrap}>
            <input
              ref={inputRef} className={styles.input} type="text"
              placeholder={`Message ${otherProfile.username}…`}
              value={msgText} onChange={e => setMsgText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              disabled={sending} maxLength={1000}
            />
          </div>
          <button className={styles.sendBtn} onClick={sendMessage} disabled={sending || !msgText.trim()}>
            <i className="ri-arrow-up-line ri-xl" />
          </button>
        </div>
      </div>

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div className={styles.ctxOverlay} onPointerDown={() => setCtxMenu(null)}>
          <div className={styles.ctxMenu} ref={ctxRef} onPointerDown={e => e.stopPropagation()}>
            <div className={styles.ctxPreview}>{ctxMenu.msg.body.slice(0, 72)}{ctxMenu.msg.body.length > 72 ? '…' : ''}</div>
            <button className={styles.ctxBtn} onClick={() => { navigator.clipboard?.writeText(ctxMenu.msg.body); setCtxMenu(null) }}>
              <i className="ri-file-copy-line" /> Copy text
            </button>
            {ctxMenu.canDelete && (
              <button className={`${styles.ctxBtn} ${styles.ctxDelete}`} onClick={() => deleteMessage(ctxMenu.msg)}>
                <i className="ri-delete-bin-line" /> Delete message
              </button>
            )}
            <button className={`${styles.ctxBtn} ${styles.ctxCancel}`} onClick={() => setCtxMenu(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
