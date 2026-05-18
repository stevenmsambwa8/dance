'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import styles from './BottomNav.module.css'

const mainLinks = [
  { href: '/',        label: 'Home',    icon: 'ri-stack-line',     iconActive: 'ri-stack-fill' },
  { href: '/matches', label: 'Matches', icon: 'ri-sword-line',     iconActive: 'ri-sword-fill' },
  { href: '/wallet',  label: 'Wallet',  icon: 'ri-wallet-3-line',  iconActive: 'ri-wallet-3-fill' },
  { href: '/feed',    label: 'Feed',    icon: 'ri-compass-3-line', iconActive: 'ri-compass-3-fill' },
]

export default function BottomNav() {
  const path = usePathname()
  const { user } = useAuth()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!user) { setUnread(0); return }
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false)
      .then(({ count }) => setUnread(count || 0))

    const channel = supabase
      .channel('bottom-nav-notifs')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => setUnread(n => n + 1))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [user])

  const isGamesActive = path.startsWith('/games')

  return (
    <div className={styles.wrapper}>

      {/* ── Floating pill — 4 main tabs ── */}
      <nav className={styles.pill}>
        {mainLinks.map(({ href, label, icon, iconActive }) => {
          const isActive = href === '/' ? path === '/' : path.startsWith(href)
          return (
            <Link key={href} href={href} className={`${styles.item} ${isActive ? styles.active : ''}`}>
              <i className={isActive ? iconActive : icon} />
              <span className={styles.label}>{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* ── Games circle — same height as pill ── */}
      <Link href="/games" className={`${styles.gamesBtn} ${isGamesActive ? styles.gamesBtnActive : ''}`}>
        <i className={isGamesActive ? 'ri-gamepad-fill' : 'ri-gamepad-line'} />
        <span className={styles.gamesLabel}>Games</span>
      </Link>

    </div>
  )
}
