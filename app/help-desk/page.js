'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'

const FAQS = [
  { q: 'How do I challenge another player?', a: 'Go to the Players page, find a player and tap the sword icon. Choose your game mode and schedule the match.' },
  { q: 'How do tiers and levels work?', a: 'You start at Gold tier. Win matches to climb tiers: Gold → Platinum → Diamond → Legend. Your level increases with total wins.' },
  { q: 'What happens at the end of a season?', a: 'Your season wins/losses reset. If you had too many losses you may drop a tier. Total wins and points carry over.' },
  { q: 'How do I join a tournament?', a: 'Open Tournaments, find an active or upcoming one and tap Join. You must be logged in.' },
  { q: 'How do I report a player?', a: 'Message us here and describe the issue. Include the player username and what happened.' },
  { q: 'My match result is wrong, what do I do?', a: 'Message us here with your match details. An admin will review and correct it.' },
  { q: 'How do I change my username or avatar?', a: 'Go to your Account page and tap Edit Profile.' },
  { q: 'How does the shop work?', a: 'Players can list items for sale. Buyers send a request and negotiate via chat. Payment is handled outside the platform.' },
]

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

const HELPDESK_EMAIL = 'nabogamingss1@gmail.com'

export default function HelpDeskPage() {
  const { user } = useAuth()
  const router   = useRouter()

  const [helpdeskProfile, setHelpdeskProfile] = useState(null)
  const [myProfile, setMyProfile]             = useState(null)
  const [messages, setMessages]               = useState([])
  const [loading, setLoading]                 = useState(true)
  const [msgText, setMsgText]                 = useState('')
  const [sending, setSending]                 = useState(false)
  const [openFaq, setOpenFaq]                 = useState(null)
  const [showFaqs, setShowFaqs]               = useState(false)

  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)

  const threadId = user && helpdeskProfile
    ? [user.id, helpdeskProfile.id].sort().join('--')
    : null

  useEffect(() => { if (user) loadAll() }, [user])

  useEffect(() => {
    if (!threadId) return
    const ch = supabase
      .channel('helpdesk--' + threadId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `thread_id=eq.${threadId}` },
        payload => {
          supabase
            .from('direct_messages')
            .select('*, sender:profiles!direct_messages_sender_id_fkey(id, username, avatar_url)')
            .eq('id', payload.new.id).single()
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
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [threadId])

  async function loadAll() {
    setLoading(true)
    const [{ data: hd }, { data: me }] = await Promise.all([
      supabase.from('profiles').select('id, username, avatar_url').eq('email', HELPDESK_EMAIL).single(),
      supabase.from('profiles').select('id, username, avatar_url').eq('id', user.id).single(),
    ])
    setHelpdeskProfile(hd || null)
    setMyProfile(me || null)
    if (hd) {
      const tid = [user.id, hd.id].sort().join('--')
      const { data: msgs } = await supabase
        .from('direct_messages')
        .select('*, sender:profiles!direct_messages_sender_id_fkey(id, username, avatar_url)')
        .eq('thread_id', tid).order('created_at', { ascending: true }).limit(300)
      setMessages(msgs || [])
    }
    setLoading(false)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 200)
  }

  async function sendMessage() {
    if (!msgText.trim() || !user || !helpdeskProfile || sending) return
    setSending(true)
    const body = msgText.trim()
    setMsgText('')
    const tid = [user.id, helpdeskProfile.id].sort().join('--')
    const optimistic = {
      id: 'opt-' + Date.now(), _optimistic: true,
      thread_id: tid, sender_id: user.id, receiver_id: helpdeskProfile.id,
      body, created_at: new Date().toISOString(), sender: myProfile,
    }
    setMessages(prev => [...prev, optimistic])
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
    await supabase.from('direct_messages').insert({ thread_id: tid, sender_id: user.id, receiver_id: helpdeskProfile.id, body })
    supabase.rpc('insert_notification', {
      p_user_id: helpdeskProfile.id, p_type: 'direct_message',
      p_title: 'Support: ' + (myProfile?.username || 'Player'),
      p_body: body.slice(0, 80),
      p_meta: { thread_id: tid, sender_id: user.id, sender_avatar: myProfile?.avatar_url || null },
    })
    setSending(false)
    inputRef.current?.focus()
  }

  if (!user) return (
    <div className={styles.page}>
      <div className={styles.centered}>
        <i className="ri-customer-service-2-line" style={{ fontSize: 36, color: 'var(--accent)' }} />
        <p>Log in to contact support</p>
        <button className={styles.primaryBtn} onClick={() => router.push('/login')}>Log In</button>
      </div>
    </div>
  )

  if (loading) return null

  return (
    <div className={styles.page}>
      <div className={styles.chatWrap}>

        {/* ── Top bar ── */}
        <div className={styles.topBar}>
          <button className={styles.backBtn} onClick={() => router.back()}>
            <i className="ri-arrow-left-line" />
          </button>

          <div className={styles.profileLink} style={{ cursor: 'default' }}>
            <div className={styles.pAvatar} style={{ border: '2px solid var(--accent)' }}>
              {helpdeskProfile?.avatar_url
                ? <img src={helpdeskProfile.avatar_url} alt="" />
                : <i className="ri-customer-service-2-line" style={{ fontSize: 18, color: 'var(--accent)' }} />
              }
              <span className={styles.statusDot} style={{ background: 'var(--accent)' }} />
            </div>
            <div className={styles.pText}>
              <span className={styles.pName}>Nabogaming Support</span>
              <span className={styles.pSub} style={{ color: 'var(--accent)', fontWeight: 700 }}>Official Help Desk</span>
            </div>
          </div>

          <button
            className={styles.viewBtn}
            onClick={() => setShowFaqs(v => !v)}
            title="FAQ"
            style={showFaqs ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}}
          >
            <i className="ri-question-line" />
          </button>
        </div>

        {/* ── FAQ Panel ── */}
        {showFaqs && (
          <div style={{
            background: 'var(--bg)', borderBottom: '1px solid var(--border)',
            maxHeight: 300, overflowY: 'auto', flexShrink: 0,
          }}>
            <div style={{ padding: '10px 16px 4px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
              Frequently Asked Questions
            </div>
            {FAQS.map((faq, i) => (
              <div key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '11px 16px', cursor: 'pointer', color: 'var(--text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', fontWeight: 600, gap: 8 }}
                >
                  <span>{faq.q}</span>
                  <i className={openFaq === i ? 'ri-subtract-line' : 'ri-add-line'} style={{ color: 'var(--accent)', flexShrink: 0, fontSize: 16 }} />
                </button>
                {openFaq === i && (
                  <div style={{ padding: '0 16px 11px', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Messages ── */}
        <div className={styles.chatBox}>
          {messages.length === 0 && (
            <div className={styles.chatEmpty}>
              <i className="ri-customer-service-2-line" />
              <div className={styles.chatEmptyName}>Nabogaming Support</div>
              <div className={styles.chatEmptyHint}>Ask us anything — we typically reply within a few hours.</div>
              <button
                onClick={() => setShowFaqs(true)}
                style={{ marginTop: 8, padding: '7px 16px', borderRadius: 8, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
              >
                <i className="ri-question-line" /> Browse FAQs
              </button>
            </div>
          )}

          {messages.map((msg, idx) => {
            const mine = msg.sender_id === user?.id
            const prev = messages[idx - 1]
            const next = messages[idx + 1]
            const isLastGroup = !next || next.sender_id !== msg.sender_id
            const showDay = idx === 0 || new Date(msg.created_at).toDateString() !== new Date(prev?.created_at).toDateString()

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
                        ? <div className={styles.msgAvatar} style={{ border: '1.5px solid var(--accent)' }}>
                            {helpdeskProfile?.avatar_url
                              ? <img src={helpdeskProfile.avatar_url} alt="" />
                              : <i className="ri-customer-service-2-line" style={{ fontSize: 13, color: 'var(--accent)' }} />
                            }
                          </div>
                        : <div className={styles.avatarSpacer} />
                      }
                    </div>
                  )}
                  <div className={styles.msgContent}>
                    <div
                      className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleTheirs} ${isLastGroup ? (mine ? styles.lastMine : styles.lastTheirs) : ''}`}
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
              ref={inputRef}
              className={styles.input}
              type="text"
              placeholder="Describe your issue…"
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              disabled={sending}
              maxLength={1000}
            />
          </div>
          <button className={styles.sendBtn} onClick={sendMessage} disabled={sending || !msgText.trim()}>
            <i className="ri-arrow-up-line ri-xl" />
          </button>
        </div>

      </div>
    </div>
  )
}
