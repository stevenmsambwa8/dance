'use client'
import Link from 'next/link'
import styles from './GameDisabledNotice.module.css'

// Shown instead of a game's page while an admin has it temporarily disabled.
export default function GameDisabledNotice({ game, status }) {
  const back = status.until
    ? new Date(status.until).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null
  return (
    <div className={styles.wrap}>
      <div className={styles.art}>
        {game.image ? <img src={game.image} alt="" /> : <i className={game.icon} />}
      </div>
      <h1 className={styles.title}>{game.name} is temporarily unavailable</h1>
      {back && <p className={styles.when}><i className="ri-time-line" /> Back on {back}</p>}
      {status.note && <p className={styles.note}>“{status.note}”</p>}
      <p className={styles.sub}>Tournaments and chat for this game are paused. It turns back on automatically.</p>
      <Link href="/games" className={styles.btn}>Browse other games</Link>
    </div>
  )
}
