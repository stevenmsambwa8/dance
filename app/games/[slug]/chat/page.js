'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'
import { GAME_META } from '../../../../lib/constants'
import UserBadges from '../../../../components/UserBadges'
import usePageLoading from '../../../../components/usePageLoading'
import styles from './page.module.css'

const ADMIN_EMAIL = 'stevenmsambwa8@gmail.com'
const SPECIAL_TTL_MS = 16 * 3600 * 1000

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
function formatPrice(p) {
  if (!p) return ''
  const n = parseFloat(String(p).replace(/,/g, ''))
  return isNaN(n) ? String(p) : 'TZS ' + n.toLocaleString()
}
function secsLeft(createdAt) {
  return Math.max(0, Math.floor((new Date(createdAt).getTime() + SPECIAL_TTL_MS - Date.now()) / 1000))
}
function fmtCountdown(s) {
  if (s <= 0) return 'Expired'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return h + 'h ' + m + 'm'
  if (m > 0) return m + 'm ' + sec + 's'
  return sec + 's'
}
function useCountdown(createdAt) {
  const [secs, setSecs] = useState(() => secsLeft(createdAt))
  useEffect(() => {
    if (secs <= 0) return
    const id = setInterval(() => {
      const r = secsLeft(createdAt)
      setSecs(r)
      if (r <= 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [createdAt])
  return secs
}

// ── Swipe-to-reply wrapper ─────────────────────────────────────────────────
const SWIPE_THRESHOLD = 64
const AXIS_LOCK_PX    = 8

function SwipeableMessage({ onReply, children }) {
  const startX  = useRef(null)
  const startY  = useRef(null)
  const locked  = useRef(null)
  const fired   = useRef(false)
  const wrapRef = useRef(null)
  const iconRef = useRef(null)

  function onTouchStart(e) {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    locked.current = null
    fired.current  = false
    if (wrapRef.current) wrapRef.current.style.transition = 'none'
    if (iconRef.current) { iconRef.current.style.transition = 'none'; iconRef.current.style.opacity = '0' }
  }

  function onTouchMove(e) {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current
    if (!locked.current) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
      locked.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
    }
    if (locked.current === 'v' || dx <= 0) return
    e.preventDefault()
    const x   = Math.min(dx, SWIPE_THRESHOLD)
    const pct = x / SWIPE_THRESHOLD
    if (wrapRef.current) wrapRef.current.style.transform = `translateX(${x}px)`
    if (iconRef.current) {
      iconRef.current.style.opacity   = String(pct)
      iconRef.current.style.transform = `translateY(-50%) scale(${0.5 + 0.5 * pct})`
    }
    if (x >= SWIPE_THRESHOLD && !fired.current) {
      fired.current = true
      onReply()
    }
  }

  function onTouchEnd() {
    startX.current = null
    if (wrapRef.current) { wrapRef.current.style.transition = 'transform 0.2s ease'; wrapRef.current.style.transform = 'translateX(0)' }
    if (iconRef.current) { iconRef.current.style.transition = 'opacity 0.2s, transform 0.2s'; iconRef.current.style.opacity = '0'; iconRef.current.style.transform = 'translateY(-50%) scale(0.5)' }
  }

  return (
    <div className={styles.swipeOuter}>
      <div ref={iconRef} className={styles.replyIcon}><i className="ri-reply-line" /></div>
      <div ref={wrapRef} className={styles.swipeInner}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}>
        {children}
      </div>
    </div>
  )
}

function MatchRequestBubble({ msg, mine, user, onAccept }) {
  const data      = msg._matchReq
  const accepted  = !!data?.accepted_by
  const iAccepted = data?.accepted_by === user?.id
  const matchId   = data?.match_id
  const secs      = useCountdown(msg.created_at)
  const expired   = secs <= 0
  const urgent    = !expired && secs < 3600

  return (
    <div className={styles.specialCard}>
      <div className={styles.specialCardHead}>
        <i className="ri-sword-fill" />
        <span>Match Request</span>
        {!accepted && (
          <span className={[styles.countdown, expired ? styles.countdownExpired : urgent ? styles.countdownUrgent : ''].join(' ')}>
            <i className="ri-timer-line" />{fmtCountdown(secs)}
          </span>
        )}
        <span className={styles.specialCardTime}>{formatTime(msg.created_at)}</span>
      </div>
      {data?.note && <p className={styles.specialCardBody}>{data.note}</p>}
      <div className={styles.specialCardGame}>
        <i className="ri-gamepad-line" /> {GAME_META[data?.game_slug]?.name || data?.game_slug}
      </div>
      {accepted ? (
        <div className={styles.specialCardAcceptedWrap}>
          <div className={styles.specialCardAccepted}>
            <i className="ri-check-double-line" />
            {iAccepted ? 'You accepted this challenge!' : `Accepted by ${data?.accepted_by_username || 'a player'}`}
          </div>
          {matchId && (
            <Link href={`/matches/${matchId}`} className={styles.viewMatchBtn} onClick={e => e.stopPropagation()}>
              <i className="ri-sword-fill" /> View Match
            </Link>
          )}
        </div>
      ) : expired ? (
        <div className={styles.specialCardWaiting}><i className="ri-time-line" /> Challenge expired</div>
      ) : mine ? (
        <div className={styles.specialCardWaiting}><i className="ri-time-line" /> Waiting for a challenger…</div>
      ) : (
        <button className={styles.specialCardBtn} onClick={() => onAccept(msg)}>
          <i className="ri-sword-line" /> Accept Challenge
        </button>
      )}
    </div>
  )
}

function ProductBubble({ data, createdAt, sentAt }) {
  const secs    = useCountdown(createdAt)
  const expired = secs <= 0
  const urgent  = !expired && secs < 3600
  const inner = (
    <div className={styles.productCardInner}>
      {/* Left: full image with countdown overlay */}
      <div className={styles.productImg}>
        {data?.image_url
          ? <img src={data.image_url} alt={data?.title} />
          : <div className={styles.productImgFallback}><i className="ri-image-line" /></div>
        }
        <span className={[styles.productCountdown, expired ? styles.countdownExpired : urgent ? styles.countdownUrgent : ''].join(' ')}>
          <i className="ri-timer-line" />{expired ? 'Expired' : fmtCountdown(secs)}
        </span>
      </div>
      {/* Right: info column */}
      <div className={styles.productInfo}>
        <div className={styles.productInfoTop}>
          <span className={styles.productTitle}>{data?.title}</span>
          <span className={styles.productSentTime}>{formatTime(sentAt || createdAt)}</span>
        </div>
        <span className={styles.productCat}>{data?.category}</span>
        <span className={styles.productPrice}>{formatPrice(data?.price)}</span>
        {expired
          ? <span className={styles.productExpiredTag}><i className="ri-forbid-line" /> Listing expired</span>
          : <span className={styles.productShopLink}>View in Shop <i className="ri-arrow-right-line" /></span>
        }
      </div>
    </div>
  )
  if (expired) return <div className={`${styles.productCard} ${styles.productCardExpired}`}>{inner}</div>
  return (
    <Link href={`/shop/${data?.item_id}`} className={styles.productCard} onClick={e => e.stopPropagation()}>
      {inner}
    </Link>
  )
}

export default function GameChat() {
  const { slug } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const game = GAME_META[slug]

  const [messages, setMessages]               = useState([])
  const [myProfile, setMyProfile]             = useState(null)
  const [loading, setLoading]                 = useState(true)
  const [memberCount, setMemberCount]         = useState(0)
  const [msgText, setMsgText]                 = useState('')
  const [sending, setSending]                 = useState(false)
  const [ctxMenu, setCtxMenu]                 = useState(null)
  const [editingId, setEditingId]             = useState(null)
  const [editText, setEditText]               = useState('')
  const [replyTo, setReplyTo]                 = useState(null)
  const [matchModal, setMatchModal]           = useState(false)
  const [matchNote, setMatchNote]             = useState('')
  const [productModal, setProductModal]       = useState(false)
  const [myProducts, setMyProducts]           = useState([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [following, setFollowing]             = useState({})
  const [chatMenuOpen, setChatMenuOpen]       = useState(false)
  const [subscribed, setSubscribed]           = useState(false)

  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)
  const longPressTimer = useRef(null)
  const ctxRef         = useRef(null)
  const chatBoxRef     = useRef(null)

  function scrollToMessage(msgId) {
    const el = document.getElementById('msg-' + msgId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add(styles.msgHighlight)
    setTimeout(() => el.classList.remove(styles.msgHighlight), 1500)
  }

  usePageLoading(loading)

  function enrichMsg(msg) {
    let meta = null
    try { meta = typeof msg.meta === 'string' ? JSON.parse(msg.meta) : (msg.meta || null) } catch {}
    const out = { ...msg, _meta: meta }
    if (msg.msg_type === 'match_request' && meta) out._matchReq = meta
    if (msg.msg_type === 'product' && meta)        out._product  = meta
    return out
  }

  useEffect(() => {
    if (!game) { router.push('/games'); return }
    loadAll()
    const ch = supabase.channel('gchat-' + slug)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat_messages', filter: 'game_slug=eq.' + slug }, payload => {
        supabase.from('game_chat_messages')
          .select('*, profiles(id, username, avatar_url, email, tier, level, country_flag, is_season_winner)')
          .eq('id', payload.new.id).single()
          .then(({ data }) => {
            if (!data) return
            const enriched = enrichMsg(data)
            setMessages(prev => {
              const optIdx = prev.findIndex(m => m._optimistic && m.sender_id === data.sender_id && m.msg_type === data.msg_type)
              if (optIdx !== -1) { const next = [...prev]; next[optIdx] = enriched; return next }
              if (prev.find(m => m.id === data.id)) return prev
              return [...prev, enriched]
            })
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
          })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_chat_messages', filter: 'game_slug=eq.' + slug }, payload => {
        setMessages(prev => prev.map(m => m.id === payload.new.id
          ? enrichMsg({ ...m, body: payload.new.body, edited: payload.new.edited, meta: payload.new.meta }) : m))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'game_chat_messages' }, payload => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [slug, user?.id])

  useEffect(() => {
    function handler(e) {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtxMenu(null)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: msgs }, { count: subs }] = await Promise.all([
      supabase.from('game_chat_messages')
        .select('*, profiles(id, username, avatar_url, email, tier, level, country_flag, is_season_winner)')
        .eq('game_slug', slug).order('created_at', { ascending: true }).limit(200),
      supabase.from('game_subscriptions').select('*', { count: 'exact', head: true }).eq('game_slug', slug),
    ])
    setMessages((msgs || []).map(enrichMsg))
    setMemberCount(subs || 0)
    if (user) {
      const { data: prof } = await supabase.from('profiles')
        .select('id, username, avatar_url, email, tier, level, country_flag, is_season_winner')
        .eq('id', user.id).single()
      setMyProfile(prof || null)
      // Check actual subscription status
      const { data: mySub } = await supabase.from('game_subscriptions')
        .select('id').eq('game_slug', slug).eq('user_id', user.id).maybeSingle()
      setSubscribed(!!mySub)
      const senderIds = [...new Set((msgs || []).map(m => m.sender_id).filter(id => id !== user.id))]
      if (senderIds.length) {
        const { data: follows } = await supabase.from('follows')
          .select('following_id').eq('follower_id', user.id).in('following_id', senderIds)
        const map = {}
        follows?.forEach(f => { map[f.following_id] = true })
        setFollowing(map)
      }
    }
    setLoading(false)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 200)
  }

  async function sendMessage() {
    if (!msgText.trim() || !user || sending) return
    setSending(true)
    const body = msgText.trim()
    const replyMeta = replyTo ? {
      reply: {
        reply_to_id: replyTo.id,
        reply_to_body: replyTo.body?.slice(0, 100),
        reply_to_user: replyTo.profiles?.username || 'Player',
        reply_to_type: replyTo.msg_type,
      }
    } : null
    setMsgText(''); setReplyTo(null)
    const optimistic = {
      id: 'opt-' + Date.now(), _optimistic: true,
      game_slug: slug, sender_id: user.id, body, msg_type: 'text',
      created_at: new Date().toISOString(), profiles: myProfile,
      meta: replyMeta ? JSON.stringify(replyMeta) : null, _meta: replyMeta,
    }
    setMessages(prev => [...prev, optimistic])
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
    const { error } = await supabase.from('game_chat_messages').insert({
      game_slug: slug, sender_id: user.id, body, msg_type: 'text',
      ...(replyMeta ? { meta: JSON.stringify(replyMeta) } : {}),
    })
    if (error) { setMessages(prev => prev.filter(m => m.id !== optimistic.id)); setMsgText(body) }
    else {
      const senderName = myProfile?.username || user.email?.split('@')[0] || 'Player'
      const [{ data: chatters }, { data: subscribers }] = await Promise.all([
        supabase.from('game_chat_messages').select('sender_id').eq('game_slug', slug).neq('sender_id', user.id).limit(500),
        supabase.from('game_subscriptions').select('user_id').eq('game_slug', slug).neq('user_id', user.id),
      ])
      const allIds = [...new Set([...(chatters?.map(c => c.sender_id) || []), ...(subscribers?.map(s => s.user_id) || [])])]
      if (allIds.length) {
        await supabase.from('notifications').insert(allIds.map(uid => ({
          user_id: uid, type: 'group_chat',
          title: `${senderName} in ${game?.name || slug} Chat`,
          body: body.slice(0, 80),
          meta: { game_slug: slug, sender_id: user.id, sender_avatar: myProfile?.avatar_url || null }, read: false,
        })))
      }
    }
    setSending(false)
    inputRef.current?.focus()
  }

  async function sendMatchRequest() {
    if (!user || sending) return
    setSending(true)
    const meta = { game_slug: slug, note: matchNote.trim() || null, accepted_by: null, accepted_by_username: null }
    const body = 'Match Request'
    const optimistic = {
      id: 'opt-' + Date.now(), _optimistic: true,
      game_slug: slug, sender_id: user.id, body, msg_type: 'match_request',
      meta: JSON.stringify(meta), _matchReq: meta,
      created_at: new Date().toISOString(), profiles: myProfile,
    }
    setMessages(prev => [...prev, optimistic])
    setMatchModal(false); setMatchNote('')
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
    const { error } = await supabase.from('game_chat_messages').insert({
      game_slug: slug, sender_id: user.id, body, msg_type: 'match_request', meta: JSON.stringify(meta),
    })
    if (error) setMessages(prev => prev.filter(m => m.id !== optimistic.id))
    setSending(false)
  }

  async function acceptMatchRequest(msg) {
    if (!user || msg.sender_id === user.id || msg._matchReq?.accepted_by) return
    const matchSlug = 'chat-' + Date.now()
    const { data: newMatch, error: matchErr } = await supabase
      .from('matches')
      .insert({ challenger_id: msg.sender_id, challenged_id: user.id, game_mode: slug, format: '1v1', status: 'pending', slug: matchSlug })
      .select('id').single()
    if (matchErr) return
    const newMeta = { ...msg._matchReq, accepted_by: user.id, accepted_by_username: myProfile?.username, match_id: newMatch.id }
    await supabase.from('game_chat_messages').update({ meta: JSON.stringify(newMeta) }).eq('id', msg.id)
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, _matchReq: newMeta } : m))
    supabase.from('notifications').insert({
      user_id: msg.sender_id, type: 'match_request_accepted',
      title: `${myProfile?.username || 'A player'} accepted your match request!`,
      body: `Your challenge in ${game?.name || slug} was accepted. Ready to play?`,
      meta: { match_id: newMatch.id, game_slug: slug }, read: false,
    })
  }

  async function openProductPicker() {
    if (!user) return
    setProductModal(true)
    if (myProducts.length) return
    setProductsLoading(true)
    const { data: items } = await supabase.from('shop_items')
      .select('id, title, price, category').eq('seller_id', user.id).eq('active', true).order('created_at', { ascending: false })
    if (items?.length) {
      const ids = items.map(i => i.id)
      const { data: imgs } = await supabase.from('shop_item_images')
        .select('item_id, url').in('item_id', ids).order('sort_order', { ascending: true })
      const imgMap = {}
      imgs?.forEach(img => { if (!imgMap[img.item_id]) imgMap[img.item_id] = img.url })
      setMyProducts(items.map(i => ({ ...i, image_url: imgMap[i.id] || null })))
    } else { setMyProducts([]) }
    setProductsLoading(false)
  }

  async function sendProduct(item) {
    if (!user || sending) return
    setSending(true); setProductModal(false)
    const meta = { item_id: item.id, title: item.title, price: item.price, category: item.category, image_url: item.image_url }
    const body = item.title
    const optimistic = {
      id: 'opt-' + Date.now(), _optimistic: true,
      game_slug: slug, sender_id: user.id, body, msg_type: 'product',
      meta: JSON.stringify(meta), _product: meta,
      created_at: new Date().toISOString(), profiles: myProfile,
    }
    setMessages(prev => [...prev, optimistic])
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
    const { error } = await supabase.from('game_chat_messages').insert({
      game_slug: slug, sender_id: user.id, body, msg_type: 'product', meta: JSON.stringify(meta),
    })
    if (error) setMessages(prev => prev.filter(m => m.id !== optimistic.id))
    setSending(false)
  }

  async function deleteMessage(msg) {
    setCtxMenu(null)
    setMessages(prev => prev.filter(m => m.id !== msg.id))
    await supabase.from('game_chat_messages').delete().eq('id', msg.id)
  }

  async function saveEdit(msg) {
    if (!editText.trim()) return
    const newBody = editText.trim()
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, body: newBody, edited: true } : m))
    setEditingId(null); setEditText('')
    await supabase.from('game_chat_messages').update({ body: newBody }).eq('id', msg.id)
  }

  async function toggleSubscribe() {
    setChatMenuOpen(false)
    if (subscribed) {
      setSubscribed(false)
      setMemberCount(c => Math.max(0, c - 1))
      await supabase.from('game_subscriptions').delete().eq('game_slug', slug).eq('user_id', user.id)
    } else {
      setSubscribed(true)
      setMemberCount(c => c + 1)
      await supabase.from('game_subscriptions').insert({ game_slug: slug, user_id: user.id })
    }
  }

  function shareChat() {
    setChatMenuOpen(false)
    const url = window.location.origin + '/games/' + slug + '/chat'
    if (navigator.share) {
      navigator.share({ title: (game?.name || slug) + ' Chat', url })
    } else {
      navigator.clipboard?.writeText(url)
    }
  }

  async function toggleFollow(targetId) {
    if (!user || targetId === user.id) return
    const isFollowing = following[targetId]
    setFollowing(prev => ({ ...prev, [targetId]: !isFollowing }))
    setCtxMenu(null)
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', targetId)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: targetId })
    }
  }

  function openCtx(e, msg) {
    e.preventDefault()
    clearTimeout(longPressTimer.current)
    const isMine = msg.sender_id === user?.id
    const isAdminUser = myProfile?.email === ADMIN_EMAIL
    setCtxMenu({
      msg, canDelete: isMine || isAdminUser,
      canEdit: isMine && msg.msg_type === 'text',
      canFollow: !isMine, senderId: msg.sender_id,
      senderUsername: msg.profiles?.username || 'Player',
    })
  }

  function onPointerDown(e, msg) {
    longPressTimer.current = setTimeout(() => openCtx(e, msg), 500)
  }

  if (!game) return null
  if (!user) return (
    <div className={styles.page}>
      <div className={styles.centered}>
        <i className="ri-lock-line" style={{ fontSize: 32, color: 'var(--text-muted)' }} />
        <p>Log in to join the chat</p>
        <Link href="/login" className={styles.primaryBtn}>Log In</Link>
      </div>
    </div>
  )
  if (loading) return null

  return (
    <div className={styles.page}>
      {game.image && <div className={styles.pageBg} style={{ backgroundImage: `url(${game.image})` }} />}
      <div className={styles.chatWrap}>

        {/* Top bar */}
        <div className={styles.topBar}>
          <Link href={`/games/${slug}`} className={styles.backBtn}><i className="ri-arrow-left-line" /></Link>
          <div className={styles.groupAvatar}>
            {game.image
              ? <img src={game.image} alt={game.name} className={styles.groupAvatarImg} />
              : <i className="ri-gamepad-fill" />}
          </div>
          <div className={styles.groupText}>
            <span className={styles.groupName}>{game.name} Chat</span>
            <span className={styles.groupSub}>{memberCount.toLocaleString()} subscribers</span>
          </div>
          <div className={styles.topBarMenu}>
            <button className={styles.menuDotsBtn} onClick={() => setChatMenuOpen(v => !v)}>
              <i className="ri-more-2-fill" />
            </button>
            {chatMenuOpen && (
              <>
                <div className={styles.menuDropdownOverlay} onClick={() => setChatMenuOpen(false)} />
                <div className={styles.menuDropdown}>
                  <button className={styles.menuDropdownItem} onClick={toggleSubscribe}>
                    <i className={subscribed ? 'ri-notification-off-line' : 'ri-notification-line'} />
                    {subscribed ? 'Unsubscribe' : 'Subscribe'}
                  </button>
                  <button className={styles.menuDropdownItem} onClick={shareChat}>
                    <i className="ri-share-line" />
                    Share Chat
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className={styles.chatBox}>
          {messages.length === 0 && (
            <div className={styles.chatEmpty}>
              <i className="ri-chat-3-line" />
              <p>No messages yet. Be the first! Subscribe Now to receive notifications.</p>
            </div>
          )}

          {messages.map((msg, idx) => {
            const mine    = msg.sender_id === user?.id
            const prev    = messages[idx - 1]
            const next    = messages[idx + 1]
            const close   = (a, b) => Math.abs(new Date(a.created_at) - new Date(b.created_at)) < 5 * 60 * 1000
            const isFirst = !prev || prev.sender_id !== msg.sender_id || (prev && !close(prev, msg))
            const isLast  = !next || next.sender_id !== msg.sender_id || (next && !close(msg, next))
            const showDay = idx === 0 || new Date(msg.created_at).toDateString() !== new Date(prev?.created_at).toDateString()
            const isEditing = editingId === msg.id
            const isSpecial = msg.msg_type === 'match_request' || msg.msg_type === 'product'
            const replyData = msg._meta?.reply || null

            return (
              <div key={msg.id} id={'msg-' + msg.id}>
                {showDay && <div className={styles.dayDivider}><span>{formatDay(msg.created_at)}</span></div>}

                <SwipeableMessage onReply={() => { setReplyTo(msg); inputRef.current?.focus() }}>
                  <div className={[
                    styles.msgRow,
                    mine ? styles.mine : styles.theirs,
                    isFirst ? styles.groupStart : '',
                    msg._optimistic ? styles.optimistic : '',
                  ].join(' ')}>

                    {!mine && (
                      <div className={styles.avatarCol}>
                        {isLast
                          ? <div className={styles.msgAvatar}>
                              {msg.profiles?.avatar_url
                                ? <img src={msg.profiles.avatar_url} alt="" />
                                : <span>{(msg.profiles?.username || '?')[0].toUpperCase()}</span>}
                            </div>
                          : <div className={styles.avatarSpacer} />
                        }
                      </div>
                    )}

                    <div className={styles.msgContent}>
                      {isEditing ? (
                        <div className={styles.editRow}>
                          <input className={styles.editInput} value={editText}
                            onChange={e => setEditText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(msg); if (e.key === 'Escape') { setEditingId(null); setEditText('') } }}
                            autoFocus maxLength={1000} />
                          <button className={styles.editSave} onClick={() => saveEdit(msg)}><i className="ri-check-line" /></button>
                          <button className={styles.editCancel} onClick={() => { setEditingId(null); setEditText('') }}><i className="ri-close-line" /></button>
                        </div>
                      ) : (
                        <div
                          className={[
                            styles.bubble,
                            mine ? styles.bubbleMine : styles.bubbleTheirs,
                            isSpecial ? styles.bubbleSpecial : '',
                            isFirst && !isLast ? (mine ? styles.firstMine : styles.firstTheirs) : '',
                            !isFirst && isLast  ? (mine ? styles.lastMine  : styles.lastTheirs)  : '',
                            !isFirst && !isLast ? (mine ? styles.midMine   : styles.midTheirs)   : '',
                          ].join(' ')}
                          onPointerDown={e => onPointerDown(e, msg)}
                          onPointerUp={() => clearTimeout(longPressTimer.current)}
                          onPointerLeave={() => clearTimeout(longPressTimer.current)}
                          onContextMenu={e => openCtx(e, msg)}
                        >
                          {/* Sender name — theirs only */}
                          {!mine && isFirst && !isSpecial && (
                            <div className={styles.bubbleSender}>
                              <span className={styles.bubbleSenderName}>{msg.profiles?.username || 'Player'}</span>
                              <UserBadges email={msg.profiles?.email} countryFlag={msg.profiles?.country_flag} isSeasonWinner={msg.profiles?.is_season_winner} size={10} gap={2} />
                              {msg.profiles?.tier && <span className={styles.bubbleSenderTier}>{msg.profiles.tier}</span>}
                            </div>
                          )}

                          {/* Reply quote */}
                          {replyData && (
                            <div
                              className={`${styles.replyQuote} ${mine ? styles.replyQuoteMine : styles.replyQuoteTheirs}`}
                              onClick={e => { e.stopPropagation(); scrollToMessage(replyData.reply_to_id) }}
                            >
                              <span className={styles.replyQuoteName}>{replyData.reply_to_user}</span>
                              <span className={styles.replyQuoteText}>
                                {replyData.reply_to_type === 'match_request' ? '⚔️ Match Request'
                                  : replyData.reply_to_type === 'product' ? '🛍️ Product'
                                  : replyData.reply_to_body || ''}
                              </span>
                            </div>
                          )}

                          {/* Message content */}
                          {msg.msg_type === 'match_request' && <MatchRequestBubble msg={msg} mine={mine} user={user} onAccept={acceptMatchRequest} />}
                          {msg.msg_type === 'product' && <ProductBubble data={msg._product} createdAt={msg.created_at} sentAt={msg.created_at} />}
                          {(!msg.msg_type || msg.msg_type === 'text') && <span className={styles.bubbleText}>{msg.body}</span>}

                          {/* Time + check — bottom right, regular bubbles only */}
                          {!isSpecial && (
                            <span className={[styles.bubbleMeta, mine ? styles.bubbleMetaMine : ''].join(' ')}>
                              {msg.edited && <span className={styles.editedTag}>edited</span>}
                              <span className={styles.bubbleTime}>{formatTime(msg.created_at)}</span>
                              {mine && <i className={`ri-check-double-line ${styles.checkIcon}`} />}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </SwipeableMessage>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply preview bar */}
        {replyTo && (
          <div className={styles.replyBar}>
            <i className="ri-reply-line" style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0 }} />
            <div className={styles.replyBarContent}>
              <span className={styles.replyBarName}>{replyTo.profiles?.username || 'Player'}</span>
              <span className={styles.replyBarText}>
                {replyTo.msg_type === 'match_request' ? '⚔️ Match Request'
                  : replyTo.msg_type === 'product' ? '🛍️ Product'
                  : (replyTo.body || '').slice(0, 60)}
              </span>
            </div>
            <button className={styles.replyBarClose} onClick={() => setReplyTo(null)}>
              <i className="ri-close-line" />
            </button>
          </div>
        )}

        {/* Input bar */}
        <div className={styles.inputArea}>
          <div className={styles.inputPill}>
            <button className={styles.actionBtn} onClick={() => setMatchModal(true)}><i className="ri-sword-line" /></button>
            <button className={styles.actionBtn} onClick={openProductPicker}><i className="ri-store-2-line" /></button>
            <input ref={inputRef} className={styles.input} type="text" placeholder="What's poppin..."
              value={msgText} onChange={e => setMsgText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              disabled={sending} maxLength={1000} />
          </div>
          <button className={styles.sendBtn} onClick={sendMessage} disabled={sending || !msgText.trim()}>
            <i className="ri-arrow-up-line" />
          </button>
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className={styles.ctxOverlay} onPointerDown={() => setCtxMenu(null)}>
          <div className={styles.ctxMenu} ref={ctxRef} onPointerDown={e => e.stopPropagation()}>
            <div className={styles.ctxPreview}>{ctxMenu.msg.body?.slice(0, 72)}{ctxMenu.msg.body?.length > 72 ? '…' : ''}</div>
            <button className={styles.ctxBtn} onClick={() => { setReplyTo(ctxMenu.msg); setCtxMenu(null); inputRef.current?.focus() }}>
              <i className="ri-reply-line" /> Reply
            </button>
            {ctxMenu.canFollow && (
              <button className={styles.ctxBtn} onClick={() => toggleFollow(ctxMenu.senderId)}>
                {following[ctxMenu.senderId]
                  ? <><i className="ri-user-unfollow-line" /> Unfollow {ctxMenu.senderUsername}</>
                  : <><i className="ri-user-follow-line" /> Follow {ctxMenu.senderUsername}</>}
              </button>
            )}
            {ctxMenu.canFollow && (
              <Link href={`/dm/${ctxMenu.senderId}`} className={styles.ctxBtn} onClick={() => setCtxMenu(null)}>
                <i className="ri-chat-private-line" /> Message {ctxMenu.senderUsername}
              </Link>
            )}
            <div className={styles.ctxDivider} />
            {ctxMenu.canEdit && (
              <button className={styles.ctxBtn} onClick={() => { setEditingId(ctxMenu.msg.id); setEditText(ctxMenu.msg.body); setCtxMenu(null) }}>
                <i className="ri-edit-line" /> Edit message
              </button>
            )}
            <button className={styles.ctxBtn} onClick={() => { navigator.clipboard?.writeText(ctxMenu.msg.body); setCtxMenu(null) }}>
              <i className="ri-file-copy-line" /> Copy text
            </button>
            {ctxMenu.canDelete && (
              <button className={`${styles.ctxBtn} ${styles.ctxDelete}`} onClick={() => deleteMessage(ctxMenu.msg)}>
                <i className="ri-delete-bin-line" /> Delete
              </button>
            )}
            <button className={`${styles.ctxBtn} ${styles.ctxCancel}`} onClick={() => setCtxMenu(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Match request bottom sheet */}
      {matchModal && (
        <div className={styles.ctxOverlay} onPointerDown={() => setMatchModal(false)}>
          <div className={styles.bottomSheet} onPointerDown={e => e.stopPropagation()}>
            <div className={styles.bottomSheetHandle} />
            <div className={styles.bottomSheetHead}>
              <i className="ri-sword-fill" style={{ color: 'var(--accent)', fontSize: 18 }} />
              <span>Send Match Request</span>
            </div>
            <p className={styles.bottomSheetSub}>Anyone in the chat can accept — first to respond gets the match.</p>
            <p className={styles.bottomSheetSub} style={{ marginTop: -4, opacity: 0.6 }}><i className="ri-timer-line" /> Auto-expires in 16 hours.</p>
            <input className={styles.bottomSheetInput} placeholder="Add a note (optional)…" value={matchNote} onChange={e => setMatchNote(e.target.value)} maxLength={120} autoFocus />
            <div className={styles.bottomSheetActions}>
              <button className={styles.modalCancel} onClick={() => setMatchModal(false)}>Cancel</button>
              <button className={styles.modalConfirm} onClick={sendMatchRequest} disabled={sending}><i className="ri-send-plane-fill" /> Send</button>
            </div>
          </div>
        </div>
      )}

      {/* Product picker bottom sheet */}
      {productModal && (
        <div className={styles.ctxOverlay} onPointerDown={() => setProductModal(false)}>
          <div className={styles.bottomSheet} onPointerDown={e => e.stopPropagation()}>
            <div className={styles.bottomSheetHandle} />
            <div className={styles.bottomSheetHead}>
              <i className="ri-store-2-fill" style={{ color: 'var(--accent)', fontSize: 18 }} />
              <span>Share a Product</span>
            </div>
            <p className={styles.bottomSheetSub}>Pick one of your active listings.</p>
            <div className={styles.productList}>
              {productsLoading && <p className={styles.productEmpty}><i className="ri-loader-4-line" /> Loading…</p>}
              {!productsLoading && myProducts.length === 0 && (
                <p className={styles.productEmpty}>No active listings. <Link href="/shop" onClick={() => setProductModal(false)}>Go to Shop →</Link></p>
              )}
              {myProducts.map(item => (
                <button key={item.id} className={styles.productPickItem} onClick={() => sendProduct(item)}>
                  {item.image_url ? <img src={item.image_url} alt={item.title} className={styles.productPickThumb} /> : <div className={styles.productPickThumbFallback}><i className="ri-image-line" /></div>}
                  <div className={styles.productPickInfo}>
                    <span className={styles.productPickTitle}>{item.title}</span>
                    <span className={styles.productPickMeta}>{item.category} · {formatPrice(item.price)}</span>
                  </div>
                  <i className="ri-share-forward-line" style={{ color: 'var(--text-muted)', fontSize: 16, flexShrink: 0 }} />
                </button>
              ))}
            </div>
            <button className={`${styles.ctxBtn} ${styles.ctxCancel}`} style={{ width: '100%' }} onClick={() => setProductModal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
