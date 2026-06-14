'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import styles from './DotsMenu.module.css'

export default function DotsMenu({ gameSlug, gameName }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const router = useRouter()
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler) }
  }, [open])

  function share() {
    setOpen(false)
    const url  = window.location.href
    const text = gameSlug
      ? `Check out the ${gameName} World Cup 2026 tournament on NaboGaming!`
      : `Check out the FIFA 26 World Cup 2026 tournament on NaboGaming!`
    if (navigator.share) {
      navigator.share({ title: gameName || 'FIFA 26 World Cup 2026', text, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => {
        alert('Link copied!')
      }).catch(() => {})
    }
  }

  function goProfile() {
    setOpen(false)
    if (user) router.push(`/profile/${user.id}`)
    else openAuthGate()
  }

  function goDetails() {
    setOpen(false)
    // Navigate to the game's page on the store / info — falls back to FIFA 26 hub
    router.push(`/games/${gameSlug}`)
  }

  const items = [
    { label: 'Share', icon: ShareIcon, action: share },
    ...(gameSlug ? [{ label: 'Game details', icon: InfoIcon, action: goDetails }] : []),
    { label: user ? 'My profile' : 'Log in', icon: UserIcon, action: goProfile },
  ]

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        aria-label="More options"
      >
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </button>

      {open && (
        <div className={styles.menu}>
          {items.map(({ label, icon: Icon, action }) => (
            <button key={label} className={styles.item} onClick={action}>
              <Icon className={styles.itemIcon} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ShareIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  )
}

function InfoIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  )
}

function UserIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}
