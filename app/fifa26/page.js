'use client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { GAME_META } from '../../lib/constants'
import styles from './page.module.css'

const FIFA_GAMES = ['efootball', 'dls', 'ufl']

export default function FIFA26Page() {
  const router = useRouter()

  return (
    <div className={styles.page}>

      {/* Hero — animated gradient */}
      <div className={styles.hero}>
        <div className={styles.heroGradient} />
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>FIFA 26</div>
          <h1 className={styles.heroTitle}>World Cup<br />2026</h1>
          <p className={styles.heroStats}>48 Nations · 104 Matches · June 11 – July 19</p>
          <div className={styles.heroHosts}>
            <div className={styles.heroHost}>
              <img src="https://flagcdn.com/w40/us.png" alt="USA" width={22} height={15}
                style={{ objectFit:'cover', borderRadius:2, flexShrink:0 }} />
              <span>USA</span>
            </div>
            <span className={styles.heroDot} />
            <div className={styles.heroHost}>
              <img src="https://flagcdn.com/w40/mx.png" alt="Mexico" width={22} height={15}
                style={{ objectFit:'cover', borderRadius:2, flexShrink:0 }} />
              <span>Mexico</span>
            </div>
            <span className={styles.heroDot} />
            <div className={styles.heroHost}>
              <img src="https://flagcdn.com/w40/ca.png" alt="Canada" width={22} height={15}
                style={{ objectFit:'cover', borderRadius:2, flexShrink:0 }} />
              <span>Canada</span>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        <p className={styles.sectionLabel}>Choose your game</p>

        <div className={styles.gameList}>
          {FIFA_GAMES.map(slug => {
            const meta = GAME_META[slug]
            return (
              <button key={slug} className={styles.gameCard}
                onClick={() => router.push(`/fifa26/${slug}`)}
              >
                <div className={styles.gameImg}>
                  <Image src={meta.image} alt={meta.name} width={60} height={60}
                    style={{ objectFit:'contain', borderRadius:12 }} />
                </div>
                <div className={styles.gameInfo}>
                  <div className={styles.gameName}>{meta.name}</div>
                  <div className={styles.gameGenre}>{meta.genre || meta.full || 'Football / Sports'}</div>
                  <div className={styles.gameDesc}>{meta.desc}</div>
                </div>
                <div className={styles.gameChevron}>›</div>
              </button>
            )
          })}
        </div>

        <div className={styles.divider} />

        <button className={styles.liveCard}
          onClick={() => router.push('/fifa26/worldcup')}
        >
          <div className={styles.livePulse}>
            <span className={styles.liveDot} />
          </div>
          <div className={styles.liveInfo}>
            <div className={styles.liveName}>Real World Cup</div>
            <div className={styles.liveSub}>Live scores · Fixtures · Standings</div>
          </div>
          <div className={styles.gameChevron}>›</div>
        </button>
      </div>
    </div>
  )
}
