'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'
import styles from './page.module.css'
import { getCurrentSeason } from '../../lib/seasons'
import usePageLoading from '../../components/usePageLoading'
import useTranslation from '../../lib/useTranslation'

export { GAME_SLUGS, GAME_META }

function Row({ title, icon, slugs, gameStats, subscribed, subLoading, loading, toggleSubscribe, t }) {
  const trackRef = useRef(null)

  function scrollBy(dir) {
    trackRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' })
  }

  return (
    <section className={styles.row}>
      <div className={styles.rowHead}>
        <h2 className={styles.rowTitle}><i className={icon} /> {title}</h2>
        <div className={styles.rowNav}>
          <button className={styles.rowNavBtn} onClick={() => scrollBy(-1)} aria-label="Scroll left"><i className="ri-arrow-left-s-line" /></button>
          <button className={styles.rowNavBtn} onClick={() => scrollBy(1)} aria-label="Scroll right"><i className="ri-arrow-right-s-line" /></button>
        </div>
      </div>
      <div className={styles.rowTrack} ref={trackRef}>
        {slugs.map(slug => {
          const meta = GAME_META[slug]
          const stats = gameStats[slug] || {}
          const isSub = subscribed[slug]
          return (
            <Link href={`/games/${slug}`} key={slug} className={styles.card} style={{ '--gc': meta.color || 'var(--accent)' }}>
              <div className={styles.cardArt}>
                {meta.image
                  ? <img src={meta.image} alt={meta.name} className={styles.cardImg} />
                  : <i className={meta.icon} />}
                <div className={styles.cardFade} />
                <button
                  className={`${styles.cardSub} ${isSub ? styles.cardSubActive : ''}`}
                  onClick={(e) => toggleSubscribe(e, slug)}
                  disabled={subLoading[slug]}
                  aria-label={isSub ? t('gamesPage.subscribed') : t('gamesPage.subscribe')}
                >
                  <i className={isSub ? 'ri-bookmark-fill' : 'ri-bookmark-line'} />
                </button>
                <div className={styles.cardBody}>
                  <span className={styles.cardGenre}>{meta.genre}</span>
                  <h3 className={styles.cardName}>{meta.name}</h3>
                  <div className={styles.cardMeta}>
                    <span><i className="ri-user-line" />{loading ? '…' : (stats.subscribers || 0).toLocaleString()}</span>
                    <span><i className="ri-trophy-line" />{loading ? '…' : (stats.tournaments || 0)}</span>
                  </div>
                </div>
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

  // Featured game for the top banner = highest subscriber count once stats load, else first game
  const featuredSlug = useMemo(() => {
    if (loading) return GAME_SLUGS[0]
    let best = GAME_SLUGS[0], bestCount = -1
    GAME_SLUGS.forEach(slug => {
      const c = gameStats[slug]?.subscribers || 0
      if (c > bestCount) { best = slug; bestCount = c }
    })
    return best
  }, [loading, gameStats])

  const featured = GAME_META[featuredSlug]
  const featuredStats = gameStats[featuredSlug] || {}
  const featuredSub = subscribed[featuredSlug]

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
    GAME_SLUGS.forEach(slug => {
      const label = normalize(GAME_META[slug].genre)
      if (!groups[label]) groups[label] = []
      groups[label].push(slug)
    })
    return groups
  }, [])

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
        <button
          className={`${styles.heroSub} ${featuredSub ? styles.heroSubActive : ''}`}
          onClick={(e) => toggleSubscribe(e, featuredSlug)}
          disabled={subLoading[featuredSlug]}
        >
          <i className={featuredSub ? 'ri-bookmark-fill' : 'ri-bookmark-line'} />
          {featuredSub ? t('gamesPage.subscribed') : t('gamesPage.subscribe')}
        </button>
      </Link>

      {/* Genre rows */}
      {Object.entries(genreGroups).map(([genre, slugs]) => (
        <Row
          key={genre}
          title={genre}
          icon={genreIcon(genre)}
          slugs={slugs}
          gameStats={gameStats}
          subscribed={subscribed}
          subLoading={subLoading}
          loading={loading}
          toggleSubscribe={toggleSubscribe}
          t={t}
        />
      ))}
    </div>
  )
}
