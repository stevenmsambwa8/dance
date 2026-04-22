'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from './ThemeProvider'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import styles from './Nav.module.css'

export default function Nav() {
  const path = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const { user, profile, signOut, isAdmin } = useAuth()
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const [notifOpen, setNotifOpen]       = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread]             = useState(0)
  const notifRef = useRef(null)

  /* ── Load notifications ── */
  useEffect(() => {
    if (!user) { setNotifications([]); setUnread(0); return }
    loadNotifications()

    const channel = supabase
      .channel(`nav-notifications-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        setNotifications(prev => [payload.new, ...prev])
        setUnread(n => n + 1)
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Nav notifications realtime error:', status, err)
        }
      })

    return () => { supabase.removeChannel(channel) }
  }, [user])

  async function loadNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications(data || [])
    setUnread((data || []).filter(n => !n.read).length)
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnread(0)
  }

  async function deleteNotif(id, e) {
    e.stopPropagation()
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications(prev => prev.filter(n => n.id !== id))
    setUnread(prev => {
      const wasUnread = notifications.find(n => n.id === id && !n.read)
      return wasUnread ? Math.max(0, prev - 1) : prev
    })
  }

  async function markRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnread(prev => Math.max(0, prev - 1))
  }

  async function handleNotifClick(notif) {
    if (!notif.read) await markRead(notif.id)
    const { item_id, request_id, tournament_id, sender_id, match_id, game_slug } = notif.meta || {}
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
    setNotifOpen(false)
  }

  useEffect(() => {
    function handler(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleSignOut() {
    await signOut()
    router.push('/login')
    setSidebarOpen(false)
  }

  const notifIcon = (type) => ({
    buy_request:            'ri-shopping-bag-line',
    negotiation_message:    'ri-chat-3-line',
    request_update:         'ri-check-double-line',
    tournament_advance:     'ri-arrow-right-circle-fill',
    tournament_win:         'ri-trophy-fill',
    tournament_champion:    'ri-vip-crown-fill',
    tournament_eliminate:   'ri-close-circle-fill',
    tournament_podium:      'ri-medal-fill',
    tournament:             'ri-node-tree',
    direct_message:         'ri-chat-private-line',
    match_request_accepted: 'ri-sword-fill',
    group_chat:             'ri-gamepad-line',
  }[type] || 'ri-notification-3-line')

  const notifColor = (type) => ({
    tournament_advance:     '#22c55e',
    tournament_win:         '#f59e0b',
    tournament_champion:    '#f59e0b',
    tournament_eliminate:   '#dc2626',
    tournament_podium:      '#94a3b8',
    tournament:             '#6366f1',
    direct_message:         '#0ea5e9',
    match_request_accepted: '#22c55e',
    group_chat:             '#a855f7',
  }[type] || null)

  const timeAgo = (ts) => {
    const s = Math.floor((Date.now() - new Date(ts)) / 1000)
    if (s < 60)    return `${s}s ago`
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  }

  return (
    <>
      <header className={styles.header}>
        <Link href="/" className={styles.logo}>
          <img src="/logo.png"       height="40" alt="Arena" className={styles.logoLight} />
          <img src="/logo-black.png" height="40" alt="Arena" className={styles.logoDark} />
        </Link>

        <nav className={styles.nav}>
          <Link href="/"            className={path === '/' ? styles.active : ''}>Dashboard</Link>
          <Link href="/matches"     className={path === '/matches' ? styles.active : ''}>Matches</Link>
          <Link href="/feed"        className={path === '/feed' ? styles.active : ''}>Feed</Link>
            <Link href="/season"        className={path === '/season' ? styles.active : ''}>Season</Link>
          <Link href="/games"       className={path.startsWith('/games') ? styles.active : ''}>Games</Link>
          <Link href="/tournaments" className={path.startsWith('/tournaments') ? styles.active : ''}>Tournaments</Link>
          <Link href="/players"     className={path.startsWith('/players') ? styles.active : ''}>Players</Link>
          <Link href="/shop"        className={path.startsWith('/shop') ? styles.active : ''}>Shop</Link>
          {isAdmin && <Link href="/dashboard" className={`${path === '/dashboard' ? styles.active : ''} ${styles.adminLink}`}>Admin</Link>}
        </nav>

        <div className={styles.right}>
          <button className={styles.iconBtn} onClick={toggle}>
            <i className={theme === 'light' ? 'ri-moon-line' : 'ri-sun-line'} />
          </button>

          {/* ── DM icon (desktop) ── */}
          {user && (
            <Link
              href="/dm"
              className={`${styles.iconBtn} ${path.startsWith('/dm') ? styles.active : ''}`}
              title="Messages"
            >
              <i className="ri-chat-private-line" />
            </Link>
          )}

          {/* ── Notification Bell ── */}
          {user && (
            <div className={styles.notifWrap} ref={notifRef}>
              <button className={styles.iconBtn} onClick={() => setNotifOpen(o => !o)} title="Notifications">
                <i className="ri-notification-3-line" />
                {unread > 0 && <span className={styles.badge}>{unread > 9 ? '9+' : unread}</span>}
              </button>

              {notifOpen && (
                <div className={styles.notifDropdown}>
                  <div className={styles.notifHeader}>
                    <span>Notifications</span>
                    {unread > 0 && (
                      <button className={styles.markAllBtn} onClick={markAllRead}>Mark all read</button>
                    )}
                  </div>
                  <div className={styles.notifList}>
                    {notifications.length === 0 && (
                      <div className={styles.notifEmpty}><i className="ri-inbox-line" /><span>No notifications yet</span></div>
                    )}
                    {notifications.map(n => (
                      <button
                        key={n.id}
                        className={`${styles.notifItem} ${!n.read ? styles.notifUnread : ''}`}
                        onClick={() => handleNotifClick(n)}
                      >
                        <div className={styles.notifIcon} style={notifColor(n.type) ? { color: notifColor(n.type), background: `${notifColor(n.type)}18` } : {}}>
                          <i className={notifIcon(n.type)} />
                        </div>
                        <div className={styles.notifContent}>
                          <p className={styles.notifTitle}>{n.title}</p>
                          {n.body && <p className={styles.notifBody}>{n.body}</p>}
                          <p className={styles.notifTime}>{timeAgo(n.created_at)}</p>
                        </div>
                        {!n.read && <span className={styles.unreadDot} />}
                        <button
                          className={styles.notifDeleteBtn}
                          onClick={e => deleteNotif(n.id, e)}
                          title="Dismiss"
                        >
                          <i className="ri-close-line" />
                        </button>
                      </button>
                    ))}
                  </div>
                  <Link href="/notifications" className={styles.notifFooter} onClick={() => setNotifOpen(false)}>
                    View all notifications <i className="ri-arrow-right-line" />
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* ── My Requests (desktop) ── */}
          {user && (
            <Link href="/my-requests" className={`${styles.iconBtn} ${path === '/my-requests' ? styles.active : ''}`} title="My Requests">
              <i className="ri-file-list-3-line" />
            </Link>
          )}

          {user ? (
            <button className={styles.iconBtn} onClick={handleSignOut} title={`Sign out (${profile?.username || user.email})`}>
              <i className="ri-logout-box-r-line" />
            </button>
          ) : (
            <Link href="/login" className={styles.iconBtn}>
              <i className="ri-user-4-line" />
            </Link>
          )}

          {user && (
            <Link href="/account" className={styles.iconBtn} title="Profile">
              {profile?.avatar_url
                ? <img src={profile.avatar_url} style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                : <i className="ri-user-3-line" />
              }
            </Link>
          )}

          <button className={styles.refreshBtn} onClick={() => window.location.reload()}>
            <i className="ri-refresh-line" />
          </button>

          {/* ── Mobile group ── */}
          <div className={styles.mobileGroup}>
            {user && (
              <Link href="/my-requests" className={`${styles.iconBtn} ${styles.mobileOnly} ${path === '/my-requests' ? styles.active : ''}`} title="My Requests">
                <i className="ri-file-list-3-line" />
              </Link>
            )}
            {user && (
              <Link href="/dm" className={`${styles.iconBtn} ${styles.mobileOnly} ${path.startsWith('/dm') ? styles.active : ''}`} title="Messages">
                <i className="ri-chat-private-line" />
              </Link>
            )}
            <Link href="/players" className={`${styles.iconBtn} ${styles.mobileOnly}`} title="Players">
              <i className="ri-group-line" />
            </Link>
            {user && (
              <Link href="/notifications" className={`${styles.iconBtn} ${styles.mobileOnly} ${styles.notifMobileBtn}`} title="Notifications"
                onClick={() => setUnread(0)}>
                <i className="ri-notification-3-line" />
                {unread > 0 && <span className={styles.badgeMobile}>{unread > 9 ? '9+' : unread}</span>}
              </Link>
            )}
          </div>

          <button className={styles.hamburger} onClick={() => setSidebarOpen(true)}>
            <i className="ri-menu-2-line" />
          </button>
        </div>
      </header>

      {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}

      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          
          <button className={styles.sidebarClose} onClick={() => setSidebarOpen(false)}>
            <i className="ri-close-line" />
          </button>
        </div>

        {user && (
          <Link href="/account" className={styles.sidebarUser} onClick={() => setSidebarOpen(false)}>
            <div className={styles.sidebarAvatar}>
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="" />
                : <span>{(profile?.username || 'P').slice(0, 2).toUpperCase()}</span>
              }
            </div>
            <div className={styles.sidebarUserInfo}>
              <div className={styles.sidebarUsername}>{profile?.username || 'Player'}</div>
              <div className={styles.sidebarTier}>{profile?.tier || ''} · Rank #{profile?.rank || '—'}</div>
            </div>
            <i className={`ri-edit-line ${styles.sidebarEditIcon}`} />
          </Link>
        )}

        <nav className={styles.sidebarNav}>
          {[
            { href: '/',            label: 'Home',        icon: 'ri-stack-line' },
            { href: '/matches',     label: 'Matches',     icon: 'ri-sword-line' },
            { href: '/feed',        label: 'Feed',        icon: 'ri-compass-3-line' },
            { href: '/games',       label: 'Games',       icon: 'ri-gamepad-line' },
            { href: '/tournaments', label: 'Tournaments', icon: 'ri-trophy-line' },
             { href: '/season', label: 'Season', icon: 'ri-trophy-line' },
            { href: '/players',     label: 'Players',     icon: 'ri-group-line' },
            { href: '/shop',        label: 'Shop',        icon: 'ri-store-2-line' },
            { href: '/my-requests', label: 'My Requests', icon: 'ri-file-list-3-line' },
          ].map(({ href, label, icon }) => {
            const isActive = href === '/' ? path === '/' : path.startsWith(href)
            return (
              <Link key={href} href={href}
                className={`${styles.sidebarLink} ${isActive ? styles.sidebarLinkActive : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <i className={icon} />
                {label}
                {!isActive && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
              </Link>
            )
          })}

          {/* ── DM in sidebar ── */}
          {user && (
            <Link href="/dm"
              className={`${styles.sidebarLink} ${path.startsWith('/dm') ? styles.sidebarLinkActive : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <i className="ri-chat-private-line" />
              Messages
              {!path.startsWith('/dm') && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
            </Link>
          )}

          {user && (
            <Link href="/notifications"
              className={`${styles.sidebarLink} ${path === '/notifications' ? styles.sidebarLinkActive : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <i className="ri-notification-3-line" />
              Notifications
              {unread > 0 && <span className={styles.sidebarBadge}>{unread}</span>}
              {path !== '/notifications' && unread === 0 && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
            </Link>
          )}

          {isAdmin && (
            <Link href="/dashboard"
              className={`${styles.sidebarLink} ${styles.sidebarAdmin} ${path === '/dashboard' ? styles.sidebarLinkActive : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <i className="ri-shield-line" />
              Admin
              {path !== '/dashboard' && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
            </Link>
          )}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.sidebarFooterActions}>
            <button className={styles.sidebarFooterBtn} onClick={toggle}>
              <i className={theme === 'light' ? 'ri-moon-line' : 'ri-sun-line'} />
              {theme === 'light' ? 'Dark' : 'Light'}
            </button>
            {user ? (
              <button className={styles.sidebarFooterBtn} onClick={handleSignOut}>
                <i className="ri-logout-box-r-line" />Sign out
              </button>
            ) : (
              <Link href="/login" className={styles.sidebarFooterBtn} onClick={() => setSidebarOpen(false)}>
                <i className="ri-user-4-line" />Log in
              </Link>
            )}
          </div>
          <div className={styles.sidebarSocials}>
            <a href="https://www.facebook.com/profile.php?id=61578110769264" target="_blank" rel="noopener noreferrer" className={styles.socialBtn} title="Facebook">
              <i className="ri-facebook-fill" />
            </a>
            <a href="https://chat.whatsapp.com/BwCQpD7wXSvCZO1hoS8Ghj?mode=gi_t" target="_blank" rel="noopener noreferrer" className={styles.socialBtn} title="WhatsApp Group">
              <i className="ri-whatsapp-line" />
            </a>
            <a href="https://www.tiktok.com/@nabogaming.com" target="_blank" rel="noopener noreferrer" className={styles.socialBtn} title="TikTok">
              <i className="ri-tiktok-line" />
            </a>
          </div>
        </div>
      </aside>
    </>
  )
}
