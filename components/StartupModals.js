'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthProvider'
import { GAME_META } from '../lib/constants'
import styles from './StartupModals.module.css'

const SNOOZE_KEY = 'nabo_startup_modals_snooze_until'
const SNOOZE_MS  = 7 * 24 * 60 * 60 * 1000 // 7 days
const EXIT_MS    = 260 // must match .closing animation duration in CSS

/**
 * Two-step startup promo: tournaments-to-join, then the Creators Hub pitch.
 * Shows on every fresh app load (mounted once in layout.js) UNTIL the person
 * taps "Remind me in 7 days" on either step — that's the only thing that
 * snoozes it. Closing with the X just skips ahead for THIS load; it comes
 * back next time the app is opened, by design ("always showing" per spec).
 * Don't wire the X to snooze — that defeats the point of this component.
 */
export default function StartupModals() {
  const { user } = useAuth()
  const [step, setStep] = useState(0) // 0 = nothing yet, 1 = tournaments, 2 = creators hub
  const [tournaments, setTournaments] = useState([])
  const [closing, setClosing] = useState(false)
  const [mounted, setMounted] = useState(false) // drives the initial entrance animation
  const closeTimer = useRef(null)

  useEffect(() => {
    const snoozeUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0)
    if (Date.now() < snoozeUntil) return // still snoozed, skip entirely

    let cancelled = false
    supabase
      .from('tournaments')
      .select('id, name, game_slug, status, entrance_fee')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => {
        if (cancelled) return
        setTournaments(data || [])
        setStep(1)
        // let the modal mount off-screen first, then animate in on the next frame
        requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)))
      })
    return () => { cancelled = true; clearTimeout(closeTimer.current) }
  }, [])

  function goToStep(next) {
    setStep(next)
  }

  function closeAll(onSnooze) {
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      if (onSnooze) localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
      setStep(0)
      setClosing(false)
      setMounted(false)
    }, EXIT_MS)
  }

  if (step === 0) return null

  return (
    <div className={`${styles.overlay} ${mounted ? styles.overlayIn : ''} ${closing ? styles.overlayOut : ''}`}>
      <div className={`${styles.modal} ${mounted ? styles.modalIn : ''} ${closing ? styles.modalOut : ''}`}>
        <div className={styles.dots}>
          <span className={`${styles.dot} ${step === 1 ? styles.dotActive : ''}`} />
          <span className={`${styles.dot} ${step === 2 ? styles.dotActive : ''}`} />
        </div>

        {step === 1 ? (
          <div key="step1" className={styles.stepPane}>
            <button className={styles.closeBtn} onClick={() => goToStep(2)} aria-label="Next">
              <i className="ri-close-line" />
            </button>
            <div className={styles.badgeWrap}>
              <span className={styles.badgeRing} />
              <div className={styles.badge}><i className="ri-trophy-fill" /></div>
            </div>
            <h3 className={styles.title}>Tournaments Happening Now</h3>
            <p className={styles.subtitle}>Jump into one before slots fill up 🔥</p>

            <div className={styles.list}>
              {tournaments.length === 0 ? (
                <p className={styles.empty}>No active tournaments right now — check back soon.</p>
              ) : tournaments.map((t, i) => (
                <Link
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  className={styles.row}
                  style={{ '--i': i }}
                  onClick={() => goToStep(2)}
                >
                  <div className={styles.rowIcon}><i className="ri-sword-fill" /></div>
                  <div className={styles.rowMeta}>
                    <span className={styles.rowName}>{t.name}</span>
                    <span className={styles.rowSub}>{GAME_META[t.game_slug]?.name || t.game_slug}</span>
                  </div>
                  <span className={styles.rowCta}>Join</span>
                </Link>
              ))}
            </div>

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={() => closeAll(true)}>Remind me in 7 days</button>
              <Link href="/tournaments" className={styles.primaryBtn} onClick={() => goToStep(2)}>
                Browse All
              </Link>
            </div>
          </div>
        ) : (
          <div key="step2" className={styles.stepPane}>
            <button className={styles.closeBtn} onClick={() => closeAll(false)} aria-label="Close">
              <i className="ri-close-line" />
            </button>
            <div className={styles.badgeWrap}>
              <span className={styles.badgeRing} />
              <div className={styles.badge}><i className="ri-vidicon-fill" /></div>
            </div>
            <h3 className={styles.title}>Creators Hub</h3>
            <p className={styles.subtitle}>Host your own tournaments and grow a following on Nabogaming.</p>

            <ul className={styles.perks}>
              <li style={{ '--i': 0 }}><i className="ri-checkbox-circle-fill" /> Verified Creator badge on your profile</li>
              <li style={{ '--i': 1 }}><i className="ri-checkbox-circle-fill" /> Priority tournament hosting perks</li>
              <li style={{ '--i': 2 }}><i className="ri-checkbox-circle-fill" /> Reach thousands of Tanzanian gamers</li>
            </ul>

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={() => closeAll(true)}>Remind me in 7 days</button>
              <button className={styles.primaryBtn} disabled>
                Explore
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
