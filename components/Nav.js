'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from './ThemeProvider'
import ThemePicker from './ThemePicker'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import NavMusicBar from './NavMusicBar'
import styles from './Nav.module.css'
import { getActivePlan, PLANS } from '../lib/plans'

export default function Nav() {
  const path = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const { user, profile, signOut, isAdmin } = useAuth()
  const isPartner  = profile?.tier === 'Partner'
  const activePlan = getActivePlan(profile)
  const planMeta   = PLANS[activePlan] || PLANS.free
  const isPaidPlan = activePlan !== 'free'
  
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread] = useState(0)
  const [showArrow, setShowArrow] = useState(true)
  
  const notifRef = useRef(null)
  const sidebarNavRef = useRef(null)

  // Scroll to top on every route change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [path])

  /* ── Track Sidebar Scroll Position to Hide Arrow at End ── */
  const handleSidebarScroll = () => {
    if (!sidebarNavRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = sidebarNavRef.current
    if (Math.ceil(scrollTop) + clientHeight >= scrollHeight - 12) {
      setShowArrow(false)
    } else {
      setShowArrow(true)
    }
  }

  // Handle manual smooth scrolling to the absolute bottom of the sidebar navigation
  const handleScrollToBottom = () => {
    if (sidebarNavRef.current) {
      sidebarNavRef.current.scrollTo({
        top: sidebarNavRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }

  useEffect(() => {
    if (sidebarOpen) {
      setTimeout(() => {
        if (sidebarNavRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = sidebarNavRef.current
          setShowArrow(Math.ceil(scrollTop) + clientHeight < scrollHeight - 12)
        }
      }, 100)
    }
  }, [sidebarOpen])

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
    } else if ((notif.type === 'match_request_accepted' || notif.type === 'match_recruit' || notif.type === 'score_request' || notif.type === 'match_result') && match_id) {
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
          <img src="/logo.png"       height="36" alt="Arena" className={styles.logoLight} />
          <img src="/logo-black.png" height="36" alt="Arena" className={styles.logoDark} />
        </Link>

        <nav className={styles.nav}>
          <Link href="/"            className={path === '/' ? styles.active : ''}>Dashboard</Link>
          <Link href="/matches"     className={path === '/matches' ? styles.active : ''}>Matches</Link>
          <Link href="/feed"        className={path === '/feed' ? styles.active : ''}>Feed</Link>
          <Link href="/season"      className={path === '/season' ? styles.active : ''}>Season</Link>
          <Link href="/games"       className={path.startsWith('/games') ? styles.active : ''}>Games</Link>
          <Link href="/tournaments" className={path.startsWith('/tournaments') ? styles.active : ''}>Tournaments</Link>
          <Link href="/players"     className={path.startsWith('/players') ? styles.active : ''}>Players</Link>
          <Link href="/shop"        className={path.startsWith('/shop') ? styles.active : ''}>Shop</Link>
          {isAdmin && <Link href="/dashboard" className={`${path === '/dashboard' ? styles.active : ''} ${styles.adminLink}`}>Admin</Link>}
        </nav>

        <div className={styles.right}>
          <button className={styles.refreshBtn} onClick={() => window.location.reload()} title="Refresh Page">
            <i className="ri-refresh-line" />
          </button>

          {/* ── Plan / Upgrade CTA ── */}
          {user ? (
            isPaidPlan ? (
              // Paid user — show their current plan, links to account/upgrade
              <Link href="/upgrade" className={styles.planCta} style={{ '--plan-color': planMeta.color }} title={`You are on the ${planMeta.label} plan`}>
                <i className={planMeta.icon} />
                <span>{planMeta.label}</span>
              </Link>
            ) : (
              // Free user — show upgrade prompt
              <Link href="/upgrade" className={styles.upgradeCta} title="Upgrade your plan">
                <i className="ri-vip-crown-line" />
                <span>Upgrade</span>
              </Link>
            )
          ) : (
            // Logged out — show login CTA
            <Link href="/login" className={styles.upgradeCta} title="Sign in">
              <i className="ri-user-line" />
              <span>Sign In</span>
            </Link>
          )}

          {/* ── Combined Cluster Group ── */}
          {user && (
            <div className={styles.combinedGroup}>
              <div className={styles.notifWrap} ref={notifRef}>
                <button className={styles.groupIconBtn} onClick={() => setNotifOpen(o => !o)} title="Notifications">
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
                        <button key={n.id} className={`${styles.notifItem} ${!n.read ? styles.notifUnread : ''}`} onClick={() => handleNotifClick(n)}>
                          <div className={styles.notifIcon} style={notifColor(n.type) ? { color: notifColor(n.type), background: `${notifColor(n.type)}18` } : {}}>
                            <i className={notifIcon(n.type)} />
                          </div>
                          <div className={styles.notifContent}>
                            <p className={styles.notifTitle}>{n.title}</p>
                            {n.body && <p className={styles.notifBody}>{n.body}</p>}
                            <p className={styles.notifTime}>{timeAgo(n.created_at)}</p>
                          </div>
                          {!n.read && <span className={styles.unreadDot} />}
                          <button className={styles.notifDeleteBtn} onClick={e => deleteNotif(n.id, e)} title="Dismiss">
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
            </div>
          )}

          <div className={styles.desktopOnly}><ThemePicker align="right" /></div>

          {user && (
            <Link href="/my-requests" className={`${styles.iconBtn} ${styles.desktopOnly} ${path === '/my-requests' ? styles.active : ''}`} title="My Requests">
              <i className="ri-file-list-3-line" />
            </Link>
          )}

          {user ? (
            <button className={`${styles.iconBtn} ${styles.desktopOnly}`} onClick={handleSignOut} title={`Sign out (${profile?.username || user.email})`}>
              <i className="ri-logout-box-r-line" />
            </button>
          ) : (
            <Link href="/login" className={`${styles.iconBtn} ${styles.desktopOnly}`}>
              <i className="ri-user-4-line" />
            </Link>
          )}

          {user && (
            <Link href="/account" className={`${styles.iconBtn} ${styles.desktopOnly}`} title="Profile">
              {profile?.avatar_url
                ? <img src={profile.avatar_url} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                : <i className="ri-user-3-line" />
              }
            </Link>
          )}

          <button className={styles.hamburger} onClick={() => setSidebarOpen(true)}>
            <i className="ri-menu-2-line" />
          </button>
        </div>
      </header>

      {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}

      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeaderBlock}>
          <div className={styles.sidebarHeaderTop}>
            <div className={styles.sidebarBrandWrap}>
              <span className={styles.sidebarBrand}>Nabogaming</span>
              <span className={styles.sidebarBrandSubtitle}>Esports Tournament Hub</span>
            </div>
            
            <button className={styles.sidebarClose} onClick={() => setSidebarOpen(false)}>
              <i className="ri-close-line" />
            </button>
          </div>

          <div className={styles.sidebarTopActions}>
            <div style={{display:'flex',alignItems:'center'}}><ThemePicker align="left" /></div>

            <Link href="/settings" className={styles.sidebarTopBtn} onClick={() => setSidebarOpen(false)}>
              <i className="ri-settings-3-line" />
              <span>Settings</span>
            </Link>

            {user ? (
              <button className={`${styles.sidebarTopBtn} ${styles.sidebarSignOutBtn}`} onClick={handleSignOut}>
                <i className="ri-logout-box-r-line" />
                <span>Sign out</span>
              </button>
            ) : (
              <Link href="/login" className={styles.sidebarTopBtn} onClick={() => setSidebarOpen(false)}>
                <i className="ri-user-4-line" />
                <span>Log in</span>
              </Link>
            )}
          </div>
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
              <div className={`${styles.sidebarTier} ${profile?.tier === 'Partner' ? styles.sidebarTierPartner : ''}`}>
                {profile?.tier === 'Partner' && <i className="ri-shield-star-fill" style={{ marginRight: 3, fontSize: 11 }} />}
                {profile?.tier || ''} · Rank #{profile?.rank || '—'}
              </div>
            </div>
            <i className={`ri-edit-line ${styles.sidebarEditIcon}`} />
          </Link>
        )}

        <nav className={styles.sidebarNav} ref={sidebarNavRef} onScroll={handleSidebarScroll}>
          {[
            { href: '/',            label: 'Home',        icon: 'ri-stack-line' },
            { href: '/matches',     label: 'Matches',     icon: 'ri-sword-line' },
            { href: '/feed',        label: 'Feed',        icon: 'ri-compass-3-line' },
            { href: '/games',       label: 'Games',       icon: 'ri-gamepad-line' },
            { href: '/tournaments', label: 'Tournaments', icon: 'ri-trophy-line' },
            { href: '/season',      label: 'Season',      icon: 'ri-dashboard-line' },
            { href: '/players',     label: 'Players',     icon: 'ri-group-line' },
            { href: '/shop',        label: 'Shop',        icon: 'ri-store-2-line' },
            { href: '/my-requests', label: 'My Requests', icon: 'ri-file-list-3-line' },
            { href: '/music',       label: 'Music',       icon: 'ri-music-2-line' },
          ].map(({ href, label, icon }) => {
            const isActive = href === '/' ? path === '/' : path.startsWith(href)
            return (
              <Link key={href} href={href} className={`${styles.sidebarLink} ${isActive ? styles.sidebarLinkActive : ''}`} onClick={() => setSidebarOpen(false)}>
                <i className={icon} />
                {label}
                {!isActive && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
              </Link>
            )
          })}

          {user && (
            <Link href="/dm" className={`${styles.sidebarLink} ${path.startsWith('/dm') ? styles.sidebarLinkActive : ''}`} onClick={() => setSidebarOpen(false)}>
              <i className="ri-chat-private-line" />
              Messages
              {!path.startsWith('/dm') && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
            </Link>
          )}

          {user && (
            <Link href="/notifications" className={`${styles.sidebarLink} ${path === '/notifications' ? styles.sidebarLinkActive : ''}`} onClick={() => setSidebarOpen(false)}>
              <i className="ri-notification-3-line" />
              Notifications
              {unread > 0 && <span className={styles.sidebarBadge}>{unread}</span>}
              {path !== '/notifications' && unread === 0 && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
            </Link>
          )}

          {isAdmin && (
            <Link href="/dashboard" className={`${styles.sidebarLink} ${styles.sidebarAdmin} ${path === '/dashboard' ? styles.sidebarLinkActive : ''}`} onClick={() => setSidebarOpen(false)}>
              <i className="ri-shield-line" />
              Admin
              {path !== '/dashboard' && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
            </Link>
          )}

          {isPartner && !isAdmin && (
            <Link href="/partner" className={`${styles.sidebarLink} ${styles.sidebarPartner} ${path === '/partner' ? styles.sidebarLinkActive : ''}`} onClick={() => setSidebarOpen(false)}>
              <i className="ri-shield-star-fill" />
              Partner Hub
              {path !== '/partner' && <i className={`ri-arrow-right-s-line ${styles.sidebarArrow}`} />}
            </Link>
          )}

          <div className={styles.sidebarFifaBlock}>
            <Link href="/fifa26" className={styles.sidebarFifaCard} onClick={() => setSidebarOpen(false)}>
              <div className={styles.sidebarFifaHeader}>
                <span className={styles.sidebarFifaBadge}>HOT</span>
                <span className={styles.sidebarFifaTitle}>FIFA 26 HUB</span>
              </div>
              <p className={styles.sidebarFifaText}>Explore active tournaments, seasonal matches, and real-time leaderboards.</p>
              <i className="ri-arrow-right-line" />
            </Link>
          </div>
        </nav>

        <button 
          className={`${styles.scrollIndicator} ${!showArrow ? styles.hideIndicator : ''}`} 
          onClick={handleScrollToBottom}
          title="Scroll to Bottom"
        >
          <i className="ri-arrow-down-s-line" />
        </button>

        {/* ── Music Player Bar ── */}
        <div className={styles.sidebarMusicWrap}>
          <NavMusicBar sidebar />
        </div>

        <div className={styles.sidebarFooter}>
          <span className={styles.sidebarVersion}>v1.2.3</span>
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
