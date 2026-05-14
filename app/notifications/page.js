'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import { GAME_META } from '../../lib/constants'
import usePageLoading from '../../components/usePageLoading'

const TYPE_META = {
  buy_request:          { icon: 'ri-shopping-bag-line',       color: '#6366f1', label: 'Buy Request' },
  negotiation_message:  { icon: 'ri-chat-3-line',             color: '#0ea5e9', label: 'Message' },
  request_update:       { icon: 'ri-check-double-line',       color: '#22c55e', label: 'Update' },
  tournament_advance:   { icon: 'ri-arrow-right-circle-fill', color: '#22c55e', label: 'Round Advanced' },
  tournament_win:       { icon: 'ri-trophy-fill',             color: '#f59e0b', label: 'Final Won' },
  tournament_champion:  { icon: 'ri-vip-crown-fill',          color: '#f59e0b', label: 'Champion!' },
  tournament_eliminate: { icon: 'ri-close-circle-fill',       color: '#dc2626', label: 'Eliminated' },
  tournament_podium:    { icon: 'ri-medal-fill',              color: '#94a3b8', label: 'Podium Finish' },
  tournament:           { icon: 'ri-node-tree',               color: '#6366f1', label: 'Tournament' },
  direct_message:       { icon: 'ri-chat-private-line',       color: '#0ea5e9', label: 'Direct Message' },
  group_chat:           { icon: 'ri-gamepad-line',            color: '#a855f7', label: 'Game Chat' },
  match_request_accepted: { icon: 'ri-sword-fill',            color: '#22c55e', label: 'Challenge Accepted' },
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <p className={styles.modalMessage}>{message}</p>
        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button className={styles.modalConfirm} onClick={onConfirm}>Clear all</button>
        </div>
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading]             = useState(true)
  usePageLoading(loading)
  const [filter, setFilter]               = useState('all')
  const [showConfirm, setShowConfirm]     = useState(false)

  useEffect(() => {
    if (!user) return
    load()

    const channel = supabase
      .channel(`notif-page-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setNotifications(prev => [payload.new, ...prev])
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Notifications page realtime error:', status, err)
        }
      })

    return () => supabase.removeChannel(channel)
  }, [user])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    setNotifications(data || [])
    setLoading(false)
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function deleteAll() {
    await supabase.from('notifications').delete().eq('user_id', user.id)
    setNotifications([])
    setShowConfirm(false)
  }

  async function handleClick(notif) {
    if (!notif.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', notif.id)
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n))
    }
    const { item_id, request_id, tournament_id, game_slug, sender_id, match_id } = notif.meta || {}
    if (notif.type === 'direct_message' && sender_id) {
      router.push(`/dm/${sender_id}`)
    } else if (notif.type === 'match_request_accepted' && match_id) {
      router.push(`/matches/${match_id}`)
    } else if (notif.type === 'group_chat' && game_slug) {
      router.push(`/games/${game_slug}/chat`)
    } else if (tournament_id) {
      router.push(`/tournaments/${tournament_id}`)
    } else if (item_id && request_id) {
      router.push(`/shop/${item_id}/request/${request_id}`)
    } else if (item_id) {
      router.push(`/shop/${item_id}`)
    }
  }

  async function deleteOne(id, e) {
    e.stopPropagation()
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  if (!user) return (
    <div className={styles.page}>
      <div className={styles.empty}><i className="ri-lock-line" /><p>Log in to see notifications</p><Link href="/login" className={styles.loginBtn}>Log In</Link></div>
    </div>
  )

  const filtered = filter === 'unread' ? notifications.filter(n => !n.read) : notifications
  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className={styles.page}>
      {showConfirm && (
        <ConfirmModal
          message="Clear all notifications?"
          onConfirm={deleteAll}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <p className={styles.eyebrow}>Your activity</p>
          <h1 className={styles.headline}>Notifications</h1>
        </div>
        <div className={styles.headerActions}>
          {unreadCount > 0 && (
            <button className={styles.iconBtn} onClick={markAllRead} title="Mark all read">
              <i className="ri-check-double-line" />
            </button>
          )}
          {notifications.length > 0 && (
            <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => setShowConfirm(true)} title="Clear all">
              <i className="ri-delete-bin-line" />
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${filter === 'all' ? styles.tabActive : ''}`} onClick={() => setFilter('all')}>
          All <span className={styles.tabCount}>{notifications.length}</span>
        </button>
        <button className={`${styles.tab} ${filter === 'unread' ? styles.tabActive : ''}`} onClick={() => setFilter('unread')}>
          Unread <span className={`${styles.tabCount} ${unreadCount > 0 ? styles.tabCountRed : ''}`}>{unreadCount}</span>
        </button>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className={styles.empty}>
          <i className="ri-notification-off-line" />
          <p>{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map(n => {
            const meta = TYPE_META[n.type] || TYPE_META.buy_request
            return (
              <button key={n.id} className={`${styles.item} ${!n.read ? styles.itemUnread : ''}`} onClick={() => handleClick(n)}>
                <div className={styles.iconWrap} style={{ '--accent': meta.color }}>
                  {n.type === 'group_chat' && n.meta?.game_slug && GAME_META[n.meta.game_slug]?.image ? (
                    <>
                      <img src={GAME_META[n.meta.game_slug].image} alt={GAME_META[n.meta.game_slug].name} className={styles.gameIconImg} />
                      {n.meta?.sender_avatar && (
                        <img src={n.meta.sender_avatar} alt="" className={styles.senderPip} />
                      )}
                    </>
                  ) : n.type === 'direct_message' && n.meta?.sender_avatar ? (
                    <img src={n.meta.sender_avatar} alt="" className={styles.dmAvatarImg} />
                  ) : (
                    <i className={meta.icon} />
                  )}
                </div>
                <div className={styles.content}>
                  <div className={styles.contentTop}>
                    <span className={styles.typeLabel} style={{ color: meta.color }}>{meta.label}</span>
                    <span className={styles.time}>{timeAgo(n.created_at)}</span>
                  </div>
                  <p className={styles.title}>{n.title}</p>
                  {n.body && <p className={styles.body}>{n.body}</p>}
                  {n.meta?.item_id && (
                    <p className={styles.cta}>View item <i className="ri-arrow-right-line" /></p>
                  )}
                </div>
                {!n.read && <span className={styles.dot} />}
                <button className={styles.deleteBtn} onClick={e => deleteOne(n.id, e)} title="Dismiss">
                  <i className="ri-close-line" />
                </button>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
