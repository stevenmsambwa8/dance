'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthProvider'
import { GAME_META } from '../lib/constants'
import styles from './StartupModals.module.css'

const SNOOZE_KEY = 'nabo_startup_modals_snooze_until'
const SNOOZE_MS  = 7 * 24 * 60 * 60 * 1000 // 7 days

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
      })
    return () => { cancelled = true }
  }, [])

  function snooze() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
    setStep(0)
  }

  if (step === 0) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {step === 1 ? (
          <>
            <button className={styles.closeBtn} onClick={() => setStep(2)}>
              <i className="ri-close-line" />
            </button>
            <div className={styles.badge}><i className="ri-trophy-fill" /></div>
            <h3 className={styles.title}>Tournaments Happening Now</h3>
            <p className={styles.subtitle}>Jump into one before slots fill up 🔥</p>

            <div className={styles.list}>
              {tournaments.length === 0 ? (
                <p className={styles.empty}>No active tournaments right now — check back soon.</p>
              ) : tournaments.map(t => (
                <Link
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  className={styles.row}
                  onClick={() => setStep(2)}
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
              <button className={styles.secondaryBtn} onClick={snooze}>Remind me in 7 days</button>
              <Link href="/tournaments" className={styles.primaryBtn} onClick={() => setStep(2)}>
                Browse All
              </Link>
            </div>
          </>
        ) : (
          <>
            <button className={styles.closeBtn} onClick={() => setStep(0)}>
              <i className="ri-close-line" />
            </button>
            <div className={styles.badge}><i className="ri-vidicon-fill" /></div>
            <h3 className={styles.title}>Creators Hub</h3>
            <p className={styles.subtitle}>Host your own tournaments and grow a following on Nabogaming.</p>

            <ul className={styles.perks}>
              <li><i className="ri-checkbox-circle-fill" /> Verified Creator badge on your profile</li>
              <li><i className="ri-checkbox-circle-fill" /> Priority tournament hosting perks</li>
              <li><i className="ri-checkbox-circle-fill" /> Reach thousands of Tanzanian gamers</li>
            </ul>

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={snooze}>Remind me in 7 days</button>
              <Link href="/creators-hub" className={styles.primaryBtn} onClick={() => setStep(0)}>
                Explore Creators Hub
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
