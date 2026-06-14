'use client'
import { useState, useEffect } from 'react'
import styles from './FifaTutorial.module.css'

const STEPS = [
  {
    title: 'Welcome to the World Cup 2026 Tournament',
    body: 'This is a community tournament running alongside the real FIFA World Cup 2026. You play the matches in-game, and results get posted here.',
    visual: 'trophy',
  },
  {
    title: 'Pick your team',
    body: 'Go to the "Pick Team" tab and choose one of the 48 nations. One player per team — first come, first served. You can drop and repick anytime.',
    visual: 'flag',
  },
  {
    title: 'Follow the fixtures',
    body: 'The "Fixtures" tab shows all group stage matches organized by date and matchday. Filter by group or matchday to find your team\'s games.',
    visual: 'fixture',
  },
  {
    title: 'Group stage standings',
    body: 'The "Table" tab updates automatically as match scores are posted. Top 2 from each group advance to the Round of 32.',
    visual: 'table',
  },
  {
    title: 'Knockout rounds',
    body: 'After the group stage, the bracket opens — Round of 32, then Round of 16, Quarter-finals, Semi-finals, and the Final. Follow your team all the way.',
    visual: 'bracket',
  },
  {
    title: "You're all set",
    body: 'Scores are posted by admins after each match is played. Check back after every game to see updated standings and who advances.',
    visual: 'check',
  },
]

const STORAGE_KEY = 'fifa26_tutorial_done'

export default function FifaTutorial({ gameSlug }) {
  const [step, setStep]       = useState(0)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    // Show tutorial once per game per browser
    const key = `${STORAGE_KEY}_${gameSlug}`
    const done = typeof window !== 'undefined' && localStorage.getItem(key)
    if (!done) setVisible(true)
  }, [gameSlug])

  function next() {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      finish()
    }
  }

  function finish() {
    setClosing(true)
    const key = `${STORAGE_KEY}_${gameSlug}`
    localStorage.setItem(key, '1')
    setTimeout(() => setVisible(false), 280)
  }

  if (!visible) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className={`${styles.overlay} ${closing ? styles.overlayOut : ''}`}>
      <div className={`${styles.card} ${closing ? styles.cardOut : ''}`}>

        {/* Progress dots */}
        <div className={styles.dots}>
          {STEPS.map((_, i) => (
            <span key={i} className={`${styles.dotStep} ${i === step ? styles.dotActive : i < step ? styles.dotDone : ''}`} />
          ))}
        </div>

        {/* Visual */}
        <div className={styles.visual}>
          <Visual type={s.visual} />
        </div>

        {/* Text */}
        <div className={styles.text}>
          <h2 className={styles.title}>{s.title}</h2>
          <p className={styles.body}>{s.body}</p>
        </div>

        {/* Action */}
        <button className={styles.btn} onClick={next}>
          {isLast ? 'Get started' : 'Next'}
        </button>

        {/* Step counter */}
        <p className={styles.counter}>{step + 1} of {STEPS.length}</p>
      </div>
    </div>
  )
}

function Visual({ type }) {
  if (type === 'trophy') return (
    <svg viewBox="0 0 80 80" fill="none" className={styles.svg}>
      <rect x="28" y="56" width="24" height="6" rx="3" fill="var(--accent)" opacity="0.3"/>
      <rect x="22" y="62" width="36" height="5" rx="2.5" fill="var(--accent)" opacity="0.4"/>
      <path d="M20 14h40v22a20 20 0 01-40 0V14z" fill="var(--accent)" opacity="0.15"/>
      <path d="M20 14h40v22a20 20 0 01-40 0V14z" stroke="var(--accent)" strokeWidth="2.5"/>
      <path d="M20 22c-4 0-8 3-8 8s4 8 8 8" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M60 22c4 0 8 3 8 8s-4 8-8 8" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="40" y1="36" x2="40" y2="56" stroke="var(--accent)" strokeWidth="2.5" opacity="0.5"/>
    </svg>
  )
  if (type === 'flag') return (
    <svg viewBox="0 0 80 80" fill="none" className={styles.svg}>
      <line x1="20" y1="16" x2="20" y2="64" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M20 18l36 8-36 12V18z" fill="var(--accent)" opacity="0.25" stroke="var(--accent)" strokeWidth="2"/>
      <circle cx="56" cy="54" r="12" fill="var(--accent)" opacity="0.12" stroke="var(--accent)" strokeWidth="2"/>
      <path d="M51 54l3 3 6-6" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  if (type === 'fixture') return (
    <svg viewBox="0 0 80 80" fill="none" className={styles.svg}>
      <rect x="14" y="22" width="52" height="42" rx="8" fill="var(--accent)" opacity="0.1" stroke="var(--accent)" strokeWidth="2"/>
      <line x1="14" y1="34" x2="66" y2="34" stroke="var(--accent)" strokeWidth="1.5" opacity="0.4"/>
      <rect x="24" y="42" width="12" height="4" rx="2" fill="var(--accent)" opacity="0.5"/>
      <rect x="44" y="42" width="12" height="4" rx="2" fill="var(--accent)" opacity="0.5"/>
      <rect x="24" y="52" width="12" height="4" rx="2" fill="var(--accent)" opacity="0.3"/>
      <rect x="44" y="52" width="12" height="4" rx="2" fill="var(--accent)" opacity="0.3"/>
      <rect x="22" y="14" width="6" height="10" rx="3" fill="var(--accent)" opacity="0.6"/>
      <rect x="52" y="14" width="6" height="10" rx="3" fill="var(--accent)" opacity="0.6"/>
      <line x1="40" y1="38" x2="40" y2="62" stroke="var(--accent)" strokeWidth="1.5" opacity="0.25" strokeDasharray="3 3"/>
    </svg>
  )
  if (type === 'table') return (
    <svg viewBox="0 0 80 80" fill="none" className={styles.svg}>
      <rect x="12" y="18" width="56" height="46" rx="8" fill="var(--accent)" opacity="0.08" stroke="var(--accent)" strokeWidth="2"/>
      <line x1="12" y1="30" x2="68" y2="30" stroke="var(--accent)" strokeWidth="1.5" opacity="0.35"/>
      {[0,1,2,3].map(i => (
        <g key={i}>
          <rect x="18" y={36+i*8} width={i===0?28:i===1?22:i===2?18:14} height="4" rx="2" fill="var(--accent)" opacity={0.5 - i*0.08}/>
          <rect x="56" y={36+i*8} width="8" height="4" rx="2" fill={i<2?"var(--accent)":'var(--border)'} opacity={i<2?0.7:0.3}/>
          {i < 2 && <rect x="14" y={36+i*8} width="3" height="4" rx="1.5" fill="var(--accent)"/>}
        </g>
      ))}
    </svg>
  )
  if (type === 'bracket') return (
    <svg viewBox="0 0 80 80" fill="none" className={styles.svg}>
      {/* R16 boxes */}
      <rect x="8"  y="18" width="18" height="8" rx="3" fill="var(--accent)" opacity="0.25"/>
      <rect x="8"  y="30" width="18" height="8" rx="3" fill="var(--accent)" opacity="0.25"/>
      <rect x="8"  y="44" width="18" height="8" rx="3" fill="var(--accent)" opacity="0.25"/>
      <rect x="8"  y="56" width="18" height="8" rx="3" fill="var(--accent)" opacity="0.25"/>
      {/* connector lines */}
      <path d="M26 22h6v10h-6" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.4"/>
      <path d="M26 48h6v10h-6" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.4"/>
      {/* QF boxes */}
      <rect x="34" y="24" width="18" height="8" rx="3" fill="var(--accent)" opacity="0.4"/>
      <rect x="34" y="50" width="18" height="8" rx="3" fill="var(--accent)" opacity="0.4"/>
      <path d="M52 28h6v26h-6" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.4"/>
      {/* Final box */}
      <rect x="58" y="35" width="16" height="12" rx="3" fill="var(--accent)" opacity="0.7"/>
    </svg>
  )
  if (type === 'check') return (
    <svg viewBox="0 0 80 80" fill="none" className={styles.svg}>
      <circle cx="40" cy="40" r="26" fill="var(--accent)" opacity="0.15" stroke="var(--accent)" strokeWidth="2.5"/>
      <path d="M27 40l9 9 17-18" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  return null
}
