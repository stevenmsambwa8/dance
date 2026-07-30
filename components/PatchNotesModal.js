'use client'

import { useEffect, useState } from 'react'
import useTranslation from '../lib/useTranslation'
import styles from './PatchNotesModal.module.css'

// Bump this whenever a new patch goes out — the modal re-appears for
// everyone once the version string changes, even if they dismissed a
// previous one. Dismissal is stored per-version in localStorage.
const PATCH_VERSION = '1.4.3'
const DISMISS_KEY = `nabo_patch_notes_seen_${PATCH_VERSION}`

// Campaign window — the popup only shows itself between these two dates.
const WINDOW_START = new Date('2026-07-29T00:00:00')
const WINDOW_END   = new Date('2026-08-03T23:59:59')

const PATCH_ITEMS = [
  { icon: 'ri-line-chart-line', key: 'progression' },
  { icon: 'ri-bug-fill',        key: 'headlinesFix' },
  { icon: 'ri-layout-4-line',   key: 'homeCleanup' },
  { icon: 'ri-shield-star-line',key: 'tierEasier' },
]

export default function PatchNotesModal() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const now = new Date()
    if (now < WINDOW_START || now > WINDOW_END) return
    if (localStorage.getItem(DISMISS_KEY)) return
    setOpen(true)
  }, [])

  function close() {
    localStorage.setItem(DISMISS_KEY, '1')
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={close}>
      <div className={styles.board} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.versionTag}>v{PATCH_VERSION}</span>
            <h3 className={styles.title}>{t('patchNotes.title')}</h3>
          </div>
          <button className={styles.closeBtn} onClick={close} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className={styles.dateRange}>
          <i className="ri-calendar-event-line" /> 29/07 – 03/08
        </div>

        <ul className={styles.list}>
          {PATCH_ITEMS.map((item) => (
            <li key={item.key} className={styles.item}>
              <span className={styles.itemIcon}><i className={item.icon} /></span>
              <span className={styles.itemText}>{t(`patchNotes.${item.key}`)}</span>
            </li>
          ))}
        </ul>

        <button className={styles.gotItBtn} onClick={close}>
          {t('patchNotes.gotIt')}
        </button>
      </div>
    </div>
  )
}
