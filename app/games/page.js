'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'
import styles from './page.module.css'
import { getCurrentSeason } from '../../lib/seasons'
import usePageLoading from '../../components/usePageLoading'
import SubscribeButton from '../../components/SubscribeButton'
import { useGames } from '../../components/GameSettingsProvider'
import useTranslation from '../../lib/useTranslation'

export { GAME_SLUGS, GAME_META }

function fmtBack(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function GameSection({ title, icon, slugs, gameStats, subscribed, subLoading, loading, toggleSubscribe, getGameStatus, t }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}><i className={icon} /> {title}</h2>
        <span className={styles.sectionCount}>{slugs.length}</span>
      </div>
      <div className={styles.grid}>
        {slugs.map(slug => {
          const meta = GAME_META[slug]
          const stats = gameStats[slug] || {}
          const isSub = subscribed[slug]
          const st    = getGameStatus(slug)
          const off   = st.state === 'disabled'
          return (
            <Link href={`/games/${slug}`} key={slug} className={`${styles.card} ${off ? styles.cardOff : ''}`} style={{ '--gc': meta.color || 'var(--accent)' }}>
              <div className={styles.cardArt}>
                {meta.image
                  ? <img src={meta.image} alt={meta.name} className={styles.cardImg} />
                  : <i className={meta.icon} />}
              </div>
              <div className={styles.cardBody}>
                <span className={styles.cardGenre}>{meta.genre}</span>
                <h3 className={styles.cardName}>{meta.name}</h3>
                <div className={styles.cardMeta}>
                  <span><i className="ri-user-line" />{loading ? '…' : (stats.subscribers || 0).toLocaleString()}</span>
                  <span><i className="ri-trophy-line" />{loading ? '…' : (stats.tournaments || 0)}</span>
                </div>
                {off ? (
                  <div className={styles.cardOffNote}><i className="ri-pause-circle-line" /> Disabled · back {fmtBack(st.until)}</div>
                ) : (
                  <SubscribeButton
                    size="sm" block
                    className={styles.cardSubBtn}
                    subscribed={isSub}
                    disabled={subLoading[slug]}
                    onClick={(e) => toggleSubscribe(e, slug)}
                    subscribeLabel={t('gamesPage.subscribe')}
                    subscribedLabel={t('gamesPage.subscribed')}
                  />
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

export default function Games() {
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const { t } = useTranslation()
  const { visibleSlugs, enabledSlugs, getGameStatus } = useGames()
  const [gameStats, setGameStats] = useState({})
  const [subscribed, setSubscribed] = useState({})
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState({})
  usePageLoading(loading)

  useEffect(() => { loadGames() }, [user])

  async function loadGames() {
    const statsPromises = GAME_SLUGS.map(async (slug) => {
      const [{ count: subCount }, { count: tourCount }] = await Promise.all([
        supabase.from('game_subscriptions').select('*', { count: 'exact', head: true }).eq('game_slug', slug),
        supabase.from('tournaments').select('*', { count: 'exact', head: true }).eq('game_slug', slug).eq('status', 'active'),
      ])
      return { slug, subscribers: subCount || 0, tournaments: tourCount || 0 }
    })

    const results = await Promise.all(statsPromises)
    const statsMap = {}
    results.forEach(r => { statsMap[r.slug] = r })
    setGameStats(statsMap)

    if (user) {
      const { data: subs } = await supabase.from('game_subscriptions').select('game_slug').eq('user_id', user.id)
      if (subs) {
        const map = {}
        subs.forEach(s => { map[s.game_slug] = true })
        setSubscribed(map)
      }
    }
    setLoading(false)
  }

  async function toggleSubscribe(e, slug) {
    e.preventDefault()
    e.stopPropagation()
    if (!user) { openAuthGate(); return }
    setSubLoading(l => ({ ...l, [slug]: true }))
    const isSub = subscribed[slug]
    setSubscribed(s => ({ ...s, [slug]: !isSub }))
    setGameStats(g => ({
      ...g,
      [slug]: { ...g[slug], subscribers: (g[slug]?.subscribers || 0) + (isSub ? -1 : 1) }
    }))
    if (isSub) {
      await supabase.from('game_subscriptions').delete().eq('user_id', user.id).eq('game_slug', slug)
    } else {
      await supabase.from('game_subscriptions').insert({ user_id: user.id, game_slug: slug })
    }
    setSubLoading(l => ({ ...l, [slug]: false }))
  }

  // Featured game for the top banner = most-subscribed LIVE game once stats load, else the first live game
  const featuredSlug = useMemo(() => {
    const pool = enabledSlugs
    if (!pool.length) return null
    if (loading) return pool[0]
    let best = pool[0], bestCount = -1
    pool.forEach(slug => {
      const c = gameStats[slug]?.subscribers || 0
      if (c > bestCount) { best = slug; bestCount = c }
    })
    return best
  }, [loading, gameStats, enabledSlugs])

  const featured = featuredSlug ? GAME_META[featuredSlug] : null
  const featuredStats = (featuredSlug && gameStats[featuredSlug]) || {}
  const featuredSub = featuredSlug ? subscribed[featuredSlug] : false

  // Group games by broad category for the rows below the hero (a few
  // GAME_META genre labels differ slightly, e.g. "Battle Royale" vs
  // "FPS / Battle Royale" — normalize so related games share one row)
  const genreGroups = useMemo(() => {
    const normalize = (genre) => {
      if (genre.includes('Battle Royale')) return 'Battle Royale'
      if (genre.includes('Sports') || genre.includes('Football')) return 'Football / Sports'
      if (genre.includes('Simulation') || genre.includes('Racing')) return 'Simulation / Racing'
      return genre
    }
    const groups = {}
    visibleSlugs.forEach(slug => {
      const label = normalize(GAME_META[slug].genre)
      if (!groups[label]) groups[label] = []
      groups[label].push(slug)
    })
    return groups
  }, [visibleSlugs])

  const genreIcon = (genre) => {
    if (genre.includes('Battle Royale')) return 'ri-crosshair-2-line'
    if (genre.includes('Sports') || genre.includes('Football')) return 'ri-football-line'
    if (genre.includes('Simulation') || genre.includes('Racing')) return 'ri-steering-2-line'
    return 'ri-gamepad-line'
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>{t('gamesPage.arenaSeasonPrefix')} {getCurrentSeason()}</p>
        <h1 className={styles.headline}>{t('gamesPage.title')}</h1>
      </div>

      {/* Featured hero banner */}
      {featured && (
      <Link href={`/games/${featuredSlug}`} className={styles.hero} style={{ '--gc': featured.color || 'var(--accent)' }}>
        {featured.image && <img src={featured.image} alt={featured.name} className={styles.heroImg} />}
        <div className={styles.heroFade} />
        <div className={styles.heroContent}>
          <span className={styles.heroBadge}><i className="ri-fire-fill" /> Most Popular</span>
          <h2 className={styles.heroName}>{featured.name}</h2>
          <p className={styles.heroDesc}>{featured.desc}</p>
          <div className={styles.heroFooter}>
            <span className={styles.heroPlay}><i className="ri-play-fill" /> View Arena</span>
            <span className={styles.heroStat}><i className="ri-user-line" /> {loading ? '…' : (featuredStats.subscribers || 0).toLocaleString()} {t('gamesPage.players')}</span>
            <span className={styles.heroStat}><i className="ri-trophy-line" /> {loading ? '…' : (featuredStats.tournaments || 0)} {t('gamesPage.tournaments')}</span>
          </div>
        </div>
        <SubscribeButton
          variant="dark"
          className={styles.heroSub}
          subscribed={featuredSub}
          disabled={subLoading[featuredSlug]}
          onClick={(e) => toggleSubscribe(e, featuredSlug)}
          subscribeLabel={t('gamesPage.subscribe')}
          subscribedLabel={t('gamesPage.subscribed')}
        />
      </Link>
      )}

      {visibleSlugs.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '40px 16px' }}>No games available right now.</p>
      )}

      {/* Genre sections (grid) */}
      {Object.entries(genreGroups).map(([genre, slugs]) => (
        <GameSection
          key={genre}
          title={genre}
          icon={genreIcon(genre)}
          slugs={slugs}
          gameStats={gameStats}
          subscribed={subscribed}
          subLoading={subLoading}
          loading={loading}
          toggleSubscribe={toggleSubscribe}
          getGameStatus={getGameStatus}
          t={t}
        />
      ))}
    </div>
  )
}
