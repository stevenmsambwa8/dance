'use client'
import Link from 'next/link'
import styles from './page.module.css'

/**
 * Static changelog. Add a new entry to the top of PATCHES whenever a
 * feature ships — no data fetching, this is hand-written release copy.
 */
const PATCHES = [
  {
    id: 'cpm2',
    date: 'September 2026',
    tag: 'New Game',
    tagIcon: 'ri-gamepad-line',
    title: 'Car Parking Multiplayer 2 is here',
    body: "CPM 2 just joined the games list. It's an open-world parking and driving simulator — 170+ cars, tuning, police, taxi and drag modes, and live multiplayer.",
    bullets: [
      'Create and join CPM 2 tournaments and matches',
      'Subscribe to CPM 2 for game updates on the Games page',
      'Add CPM 2 as one of your Game Tags in Settings',
    ],
    cta: { href: '/games/cpm2', label: 'View CPM 2' },
  },
  {
    id: 'clans',
    date: 'August 2026',
    tag: 'Feature',
    tagIcon: 'ri-shield-star-line',
    title: 'Clans',
    body: 'Build a clan around your favorite game, invite players with an invite code, and organize members into squads.',
    bullets: [
      'Up to 125 members per clan, organized into squads of up to 25',
      'Custom clan tag, colors, logo and banner',
      'Per-game clans — browse and search clans by game',
    ],
    cta: { href: '/clans', label: 'Browse Clans' },
  },
  {
    id: 'daily-rewards',
    date: 'August 2026',
    tag: 'Feature',
    tagIcon: 'ri-gift-line',
    title: 'Daily login rewards',
    body: 'Log in every day to build a 7-day streak and claim rewards along the way. Miss a day and the streak resets to Day 1.',
    bullets: [
      'Claim from the popup or anytime on the Rewards page',
      'Streak resets to Day 1 if a day is missed',
    ],
    cta: { href: '/rewards', label: 'Open Rewards' },
  },
]

export default function PatchesPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Changelog</p>
        <h1 className={styles.headline}>What's New</h1>
        <p className={styles.sub}>New games and features on Nabogaming, most recent first.</p>
      </div>

      <div className={styles.timeline}>
        {PATCHES.map((p, i) => (
          <div key={p.id} className={styles.entry}>
            <div className={styles.rail}>
              <div className={styles.dot}>
                {i === 0 && <span className={styles.dotPulse} />}
              </div>
              {i < PATCHES.length - 1 && <div className={styles.line} />}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.tagChip}><i className={p.tagIcon} />{p.tag}</span>
                <span className={styles.date}>{p.date}</span>
              </div>
              <h2 className={styles.title}>{p.title}</h2>
              <p className={styles.body}>{p.body}</p>
              {p.bullets && (
                <ul className={styles.bullets}>
                  {p.bullets.map((b, bi) => <li key={bi}>{b}</li>)}
                </ul>
              )}
              {p.cta && (
                <Link href={p.cta.href} className={styles.cta}>
                  {p.cta.label}
                  <i className="ri-arrow-right-line" />
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
