'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '../../components/LanguageProvider'
import styles from './page.module.css'

/**
 * /app — APK download page.
 *
 * The Install APK button stays locked until UNLOCK_AT, then turns into a
 * normal download link. Put the APK in /public and point APK_URL at it
 * (or use any full URL, e.g. a GitHub release link).
 *
 * UNLOCK_AT = 30 Sep 2026, 00:00 East Africa Time (UTC+3).
 */
const APK_URL   = '/nabogaming.apk'
const UNLOCK_AT = new Date('2026-09-30T00:00:00+03:00').getTime()

const COPY = {
  sw: {
    title:    'Pakua Nabogaming kwa Android',
    lockedSub:'App ya Android inakuja. Kitufe cha kupakua kitafunguka muda ukiisha.',
    openSub:  'App ya Android iko tayari. Bonyeza kitufe kupakua.',
    opens:    'Inafunguka 30 Septemba 2026',
    open:     'Inapatikana sasa',
    units:    ['Siku', 'Saa', 'Dakika', 'Sekunde'],
    button:   'Install APK',
  },
  en: {
    title:    'Get Nabogaming on Android',
    lockedSub:'The Android app is on its way. The download button unlocks when the countdown ends.',
    openSub:  'The Android app is ready. Tap the button to download.',
    opens:    'Opens 30 September 2026',
    open:     'Available now',
    units:    ['Days', 'Hours', 'Minutes', 'Seconds'],
    button:   'Install APK',
  },
}

const pad = (n) => String(n).padStart(2, '0')

function split(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return [
    Math.floor(total / 86400),
    Math.floor((total % 86400) / 3600),
    Math.floor((total % 3600) / 60),
    total % 60,
  ]
}

export default function AppDownloadPage() {
  const { lang } = useLanguage()
  const c = COPY[lang] || COPY.sw

  // null until mounted so server and client markup match.
  const [now, setNow] = useState(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const ready    = now !== null
  const unlocked = ready && now >= UNLOCK_AT
  const parts    = ready ? split(UNLOCK_AT - now) : null

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>{c.title}</h1>
        <p className={styles.sub}>{unlocked ? c.openSub : c.lockedSub}</p>

        {!unlocked && (
          <div className={styles.timer} role="timer" aria-label={c.opens}>
            {c.units.map((label, i) => (
              <div key={label} className={styles.unit}>
                <span className={styles.digits}>
                  {parts ? (i === 0 ? parts[i] : pad(parts[i])) : '--'}
                </span>
                <span className={styles.unitLabel}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {unlocked ? (
          <a className={styles.btn} href={APK_URL} download>
            <i className="ri-download-2-line" />
            {c.button}
          </a>
        ) : (
          <button className={styles.btn} disabled aria-disabled="true">
            <i className="ri-lock-line" />
            {c.button}
          </button>
        )}

        <p className={styles.note}>{unlocked ? c.open : c.opens}</p>
      </div>
    </div>
  )
}
