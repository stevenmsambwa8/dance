'use client'
import { useEffect, useState, useCallback } from 'react'
import { registerDialogHost } from '../lib/dialog'
import styles from './DialogHost.module.css'

const DANGER_RE = /\b(delete|remove|reject|forfeit|disconnect|cancel|reset)\b/i

export default function DialogHost() {
  const [queue, setQueue] = useState([])
  const current = queue[0]

  useEffect(() => registerDialogHost((d) => setQueue((q) => [...q, d])), [])

  const close = useCallback((result) => {
    setQueue((q) => {
      q[0]?.resolve(result)
      return q.slice(1)
    })
  }, [])

  useEffect(() => {
    if (!current) return
    const onKey = (e) => {
      if (e.key === 'Escape') close(current.type === 'confirm' ? false : undefined)
      if (e.key === 'Enter') close(current.type === 'confirm' ? true : undefined)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, close])

  if (!current) return null

  const isConfirm = current.type === 'confirm'
  const danger = current.danger ?? (isConfirm && DANGER_RE.test(current.message))
  const title = current.title || (isConfirm ? 'Are you sure?' : 'Heads up')
  const icon = isConfirm
    ? (danger ? 'ri-error-warning-fill' : 'ri-question-fill')
    : 'ri-information-fill'

  return (
    <div className={styles.overlay} onClick={() => close(isConfirm ? false : undefined)}>
      <div
        className={styles.dialog}
        role={isConfirm ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`${styles.icon} ${danger ? styles.iconDanger : ''}`}>
          <i className={icon} />
        </div>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{current.message}</p>
        <div className={styles.actions}>
          {isConfirm && (
            <button className={styles.btnGhost} onClick={() => close(false)}>
              {current.cancelText || 'Cancel'}
            </button>
          )}
          <button
            className={`${styles.btnPrimary} ${danger ? styles.btnDanger : ''}`}
            onClick={() => close(isConfirm ? true : undefined)}
            autoFocus
          >
            {current.confirmText || (isConfirm ? (danger ? 'Confirm' : 'Yes') : 'OK')}
          </button>
        </div>
      </div>
    </div>
  )
}
