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

function getConfig(type, meta) {
  const base = NOTIF_CONFIG[type] || {
    icon:   'ri-notification-3-line',
    color:  null,
    label:  'Notification',
    action: 'View',
    route:  () => '/notifications',
  }
  // Override action label and route if admin set a custom CTA
  if (meta?.cta_link) {
    return {
      ...base,
      action: meta.cta_label || base.action,
      route:  () => meta.cta_link,
    }
  }
  return base
}

// Announcement type not in NOTIF_CONFIG — add it
NOTIF_CONFIG.announcement = {
  icon:   'ri-megaphone-fill',
  color:  '#6366f1',
  label:  'Announcement',
  action: 'Read',
  route:  (n) => n.meta?.cta_link || '/notifications',
}

/* ─── Single toast component ─────────────────────────────── */
function Toast({ id, notif, onDismiss, onAction }) {
  const cfg          = getConfig(notif.type, notif.meta)
  const [leaving,       setLeaving]       = useState(false)
  const [dragX,         setDragX]         = useState(0)
  const [dragging,      setDragging]      = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const startX    = useRef(null)
  const startY    = useRef(null)
  const axisLocked = useRef(false)
  const dragXRef  = useRef(0)

  function dismiss() {
    setDragX(0)
    setLeaving(true)
    setTimeout(() => onDismiss(id), 340)
  }

  async function deleteNotif() {
    setDeleting(true)
    await supabase.from('notifications').delete().eq('id', notif.id)
    dismiss()
  }

  function updateDrag(dx) {
    const clamped = Math.max(0, dx)
    dragXRef.current = clamped
    setDragX(clamped)
  }

  function finishDrag() {
    if (dragXRef.current > 80) {
      setDragX(400)
      dismiss()
    } else {
      setDragX(0)
    }
    setDragging(false)
    startX.current   = null
    startY.current   = null
    axisLocked.current = false
  }

  /* ── Touch ── */
  function onTouchStart(e) {
    startX.current   = e.touches[0].clientX
    startY.current   = e.touches[0].clientY
    axisLocked.current = false
    dragXRef.current = 0
    setDragging(true)
  }

  function onTouchMove(e) {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    const dy = Math.abs(e.touches[0].clientY - startY.current)
    if (!axisLocked.current) {
      if (Math.abs(dx) < 5 && dy < 5) return
      axisLocked.current = true
      if (dy > Math.abs(dx)) { startX.current = null; setDragging(false); return }
    }
    if (dx > 0) { e.preventDefault(); updateDrag(dx) }
  }

  function onTouchEnd() { finishDrag() }

  /* ── Mouse drag (desktop) ── */
  function onMouseDown(e) {
    if (e.button !== 0) return
    startX.current   = e.clientX
    dragXRef.current = 0
    setDragging(true)

    function onMove(ev) {
      const dx = ev.clientX - startX.current
      if (dx > 0) updateDrag(dx)
    }
    function onUp() {
      finishDrag()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }

  const opacity   = dragX > 0 ? Math.max(0, 1 - dragX / 180) : 1
  const showHint  = dragX > 28

  return (
    <div
      className={`${styles.toast} ${leaving ? styles.toastLeave : styles.toastEnter}`}
      style={{
        transform:   `translateX(${dragX}px)`,
        transition:  dragging ? 'none' : 'transform 0.28s cubic-bezier(0.25,1,0.5,1), opacity 0.28s ease',
        opacity,
        touchAction: 'pan-y',
        userSelect:  'none',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
    >
      {/* Swipe hint — arrow appears when dragging right */}
      {showHint && (
        <div className={styles.swipeHint} style={{ opacity: Math.min(1, (dragX - 28) / 40) }}>
          <i className="ri-arrow-right-line" />
        </div>
      )}

      {/* Icon */}
      <div className={styles.toastIcon} style={{ color: cfg.color || 'var(--text)', background: (cfg.color || '#888') + '18' }}>
        <i className={cfg.icon} />
      </div>

      {/* Content — only fires tap if not a drag */}
      <div className={styles.toastBody} onClick={() => { if (dragX < 6) { onAction(notif); dismiss() } }}>
        <div className={styles.toastApp}>Nabogaming</div>
        <div className={styles.toastTitle}>{cfg.label}</div>
        <div className={styles.toastMsg}>{notif.body || notif.title}</div>
        <div className={styles.toastAction}>{cfg.action} <i className="ri-arrow-right-s-line" /></div>
      </div>

      {/* Dismiss button (X) */}
      <button className={styles.toastClose} onClick={e => { e.stopPropagation(); dismiss() }}>
        <i className="ri-close-line" />
      </button>

      {/* Delete notification button + confirmation */}
      {!confirmDelete ? (
        <button className={styles.toastDelete} onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}>
          <i className="ri-delete-bin-line" />
        </button>
      ) : (
        <div className={styles.toastConfirm} onClick={e => e.stopPropagation()}>
          <span className={styles.toastConfirmText}>Delete?</span>
          <button className={styles.toastConfirmYes} onClick={deleteNotif} disabled={deleting}>
            {deleting ? <i className="ri-loader-4-line" /> : <i className="ri-check-line" />}
          </button>
          <button className={styles.toastConfirmNo} onClick={() => setConfirmDelete(false)}>
            <i className="ri-close-line" />
          </button>
        </div>
      )}
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

  // On sign-in: load all unread notifications and queue as toasts
  useEffect(() => {
    if (!user) return

    // Reset seen set for this user session so fresh login shows all pending
    seenIds.current = new Set()

    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .eq('read', false)
      .order('created_at', { ascending: true }) // oldest first so newest stacks on top
      .limit(10)
      .then(({ data }) => {
        if (!data?.length) return
        // Stagger them slightly so they don't all slam in at once
        data.forEach((notif, i) => {
          setTimeout(() => addToast(notif), i * 120)
        })
      })

    // Realtime — listen for new notifications arriving while logged in
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

    // Do NOT remove toasts on cleanup — they persist across page switches
    // Only clean up the realtime channel
    return () => supabase.removeChannel(channel)
  }, [user?.id, addToast]) // use user.id not user object to avoid re-runs on profile updates

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
