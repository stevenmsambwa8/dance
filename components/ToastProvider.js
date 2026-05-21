'use client'
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import styles from './ToastProvider.module.css'

/* ─── Context ─────────────────────────────────────────────── */
const ToastContext = createContext(null)
export const useToast = () => useContext(ToastContext)

/* ─── Notification type config ───────────────────────────── */
const NOTIF_CONFIG = {
  buy_request:            { icon: 'ri-shopping-bag-fill',      color: '#22c55e', label: 'New Buy Request',      action: 'View Request',   route: (n) => n.meta?.item_id    ? `/shop/${n.meta.item_id}`                          : '/shop'             },
  request_update:         { icon: 'ri-check-double-line',      color: '#22c55e', label: 'Offer Update',         action: 'View',           route: (n) => n.meta?.request_id ? `/shop/${n.meta.item_id}/request/${n.meta.request_id}` : '/shop'           },
  negotiation_message:    { icon: 'ri-chat-3-line',            color: '#0ea5e9', label: 'New Message',          action: 'Reply',          route: (n) => n.meta?.item_id    ? `/shop/${n.meta.item_id}/request/${n.meta.request_id}` : '/shop'           },
  direct_message:         { icon: 'ri-chat-private-line',      color: '#0ea5e9', label: 'Direct Message',       action: 'Reply',          route: (n) => n.meta?.sender_id  ? `/dm/${n.meta.sender_id}`                          : '/notifications'    },
  match_request_accepted: { icon: 'ri-sword-fill',             color: '#22c55e', label: 'Challenge Accepted',   action: 'View Match',     route: (n) => n.meta?.match_id   ? `/matches/${n.meta.match_id}`                      : '/matches'          },
  match_challenged:       { icon: 'ri-swords-line',            color: '#6366f1', label: 'New Challenge',        action: 'Respond',        route: (n) => n.meta?.match_id   ? `/matches/${n.meta.match_id}`                      : '/matches'          },
  match_completed:        { icon: 'ri-flag-fill',              color: '#f59e0b', label: 'Match Result',         action: 'View Result',    route: (n) => n.meta?.match_id   ? `/matches/${n.meta.match_id}`                      : '/matches'          },
  tournament:             { icon: 'ri-node-tree',              color: '#6366f1', label: 'Tournament',           action: 'Open',           route: (n) => n.meta?.tournament_id ? `/tournaments/${n.meta.tournament_id}`            : '/tournaments'      },
  tournament_advance:     { icon: 'ri-arrow-right-circle-fill',color: '#22c55e', label: 'You Advanced! 🎉',    action: 'View Bracket',   route: (n) => n.meta?.tournament_id ? `/tournaments/${n.meta.tournament_id}`            : '/tournaments'      },
  tournament_win:         { icon: 'ri-trophy-fill',            color: '#f59e0b', label: 'Tournament Win! 🏆',  action: 'See Results',    route: (n) => n.meta?.tournament_id ? `/tournaments/${n.meta.tournament_id}`            : '/tournaments'      },
  tournament_champion:    { icon: 'ri-vip-crown-fill',         color: '#f59e0b', label: 'Champion! 👑',        action: 'View Trophy',    route: (n) => n.meta?.tournament_id ? `/tournaments/${n.meta.tournament_id}`            : '/tournaments'      },
  tournament_eliminate:   { icon: 'ri-close-circle-fill',      color: '#ef4444', label: 'Eliminated',          action: 'View Bracket',   route: (n) => n.meta?.tournament_id ? `/tournaments/${n.meta.tournament_id}`            : '/tournaments'      },
  tournament_podium:      { icon: 'ri-medal-fill',             color: '#94a3b8', label: 'Podium Finish! 🥈',   action: 'See Results',    route: (n) => n.meta?.tournament_id ? `/tournaments/${n.meta.tournament_id}`            : '/tournaments'      },
  group_chat:             { icon: 'ri-gamepad-line',           color: '#a855f7', label: 'Game Chat',           action: 'Join Chat',      route: (n) => n.meta?.game_slug   ? `/games/${n.meta.game_slug}/chat`                  : '/games'            },
  follow:                 { icon: 'ri-user-follow-fill',       color: '#0ea5e9', label: 'New Follower',        action: 'View Profile',   route: (n) => n.meta?.follower_id ? `/profile/${n.meta.follower_id}`                   : '/players'          },
  season_ended:           { icon: 'ri-calendar-check-fill',   color: '#f59e0b', label: 'Season Ended',        action: 'See Rankings',   route: () => '/players'                                                                                       },
  tier_up:                { icon: 'ri-shield-star-fill',       color: '#22c55e', label: 'Tier Up! 🎊',        action: 'View Profile',   route: () => '/account'                                                                                       },
  level_up:               { icon: 'ri-bar-chart-fill',         color: '#06b6d4', label: 'Level Up! ⚡',       action: 'View Profile',   route: () => '/account'                                                                                       },
}

function getConfig(type) {
  return NOTIF_CONFIG[type] || {
    icon:   'ri-notification-3-line',
    color:  null,
    label:  'Notification',
    action: 'View',
    route:  () => '/notifications',
  }
}

/* ─── Single toast component ─────────────────────────────── */
function Toast({ id, notif, onDismiss, onAction }) {
  const cfg       = getConfig(notif.type)
  const [leaving, setLeaving] = useState(false)
  const timerRef  = useRef(null)

  function dismiss() {
    setLeaving(true)
    setTimeout(() => onDismiss(id), 340)
  }

  function startAutoDismiss() {
    timerRef.current = setTimeout(dismiss, 5000)
  }

  useEffect(() => {
    startAutoDismiss()
    return () => clearTimeout(timerRef.current)
  }, [])

  return (
    <div
      className={`${styles.toast} ${leaving ? styles.toastLeave : styles.toastEnter}`}
      onMouseEnter={() => clearTimeout(timerRef.current)}
      onMouseLeave={startAutoDismiss}
    >
      {/* Left accent bar */}
      <div className={styles.toastAccent} style={{ background: cfg.color || 'var(--text)' }} />

      {/* Icon */}
      <div className={styles.toastIcon} style={{ color: cfg.color || 'var(--text)', background: (cfg.color || '#888') + '18' }}>
        <i className={cfg.icon} />
      </div>

      {/* Content */}
      <div className={styles.toastBody} onClick={() => { onAction(notif); dismiss() }}>
        <div className={styles.toastApp}>Nabogaming</div>
        <div className={styles.toastTitle}>{cfg.label}</div>
        <div className={styles.toastMsg}>{notif.body || notif.title}</div>
        <div className={styles.toastAction}>
          {cfg.action} <i className="ri-arrow-right-s-line" />
        </div>
      </div>

      {/* Dismiss */}
      <button className={styles.toastClose} onClick={e => { e.stopPropagation(); dismiss() }}>
        <i className="ri-close-line" />
      </button>

      {/* Progress bar */}
      <div className={styles.toastProgress} style={{ animationDuration: '5000ms' }} />
    </div>
  )
}

/* ─── Provider ───────────────────────────────────────────── */
export function ToastProvider({ children }) {
  const { user } = useAuth()
  const router   = useRouter()
  const [toasts, setToasts] = useState([])
  const seenIds  = useRef(new Set())

  const addToast = useCallback((notif) => {
    if (seenIds.current.has(notif.id)) return
    seenIds.current.add(notif.id)
    setToasts(prev => [{ id: notif.id, notif }, ...prev].slice(0, 5)) // max 5 at once
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const handleAction = useCallback((notif) => {
    const cfg  = getConfig(notif.type)
    const path = cfg.route(notif)
    router.push(path)
    // Mark read
    supabase.from('notifications').update({ read: true }).eq('id', notif.id).then(() => {})
  }, [router])

  // Realtime — listen for new notifications
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`toast-notif-${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.new) addToast(payload.new)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user, addToast])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast stack — fixed top, full-width, Apple-style */}
      <div className={styles.stack} aria-live="polite" aria-atomic="false">
        {toasts.map(({ id, notif }) => (
          <Toast
            key={id}
            id={id}
            notif={notif}
            onDismiss={removeToast}
            onAction={handleAction}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
