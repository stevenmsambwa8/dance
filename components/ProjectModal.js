'use client'
import { useEffect } from 'react'
import styles from './ProjectModal.module.css'

export default function ProjectModal({ project, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  if (!project) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose}>✕</button>

        <div className={styles.body}>
          <div className={styles.meta}>
            <span className={styles.category}>{project.category}</span>
            <span className={styles.year}>{project.year}</span>
          </div>

          <h2 className={styles.title}>{project.title}</h2>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span>Rank</span>
              <strong>{project.rank}</strong>
            </div>
            <div className={styles.stat}>
              <span>Record</span>
              <strong>{project.record}</strong>
            </div>
          </div>

          <p className={styles.desc}>{project.desc}</p>

          <div className={styles.tags}>
            {(project.tags || []).map(tag => (
              <span key={tag} className={styles.tag}>{tag}</span>
            ))}
          </div>

          <div className={styles.actions}>
            <button className={styles.btnAccept}>ACCEPT MATCH</button>
            <button className={styles.btnDecline}>DECLINE</button>
          </div>
        </div>
      </div>
    </div>
  )
}
