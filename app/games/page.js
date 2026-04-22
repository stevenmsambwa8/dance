'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'
import styles from './page.module.css'
import { getCurrentSeason, getSeasonDateRange, getDaysRemaining } from '../../lib/seasons'
import usePageLoading from '../../components/usePageLoading'

export { GAME_SLUGS, GAME_META }

export default function Games() {
  const { user } = useAuth()
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
    if (!user) { window.location.href = '/login'; return }
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Arena · Season {getCurrentSeason()}</p>
        <h1 className={styles.headline}>GAMES</h1>
      </div>

      <div className={styles.list}>
        {GAME_SLUGS.map((slug, i) => {
          const meta = GAME_META[slug]
          const stats = gameStats[slug] || {}
          const isSub = subscribed[slug]
          return (
            <div key={slug} className={styles.rowWrap}>
              <Link href={`/games/${slug}`} className={styles.row}>
                <span className={styles.num}>0{i + 1}</span>
                <div className={styles.icon}>
                  {meta.image
                    ? <img src={meta.image} alt={meta.name} className={styles.gameImg} />
                    : <i className={meta.icon} />}
                </div>
                <div className={styles.info}>
                  <div className={styles.infoTop}>
                    <h2>{meta.name}</h2>
                    <button
                      className={`${styles.subBtn} ${isSub ? styles.subActive : ''}`}
                      onClick={(e) => toggleSubscribe(e, slug)}
                      disabled={subLoading[slug]}
                    >
                      {isSub ? 'Subscribed' : 'Subscribe'}
                    </button>
                  </div>
                  <span>{meta.genre} · {meta.full}</span>
                </div>
                <div className={styles.meta}>
                  <span className={styles.metaItem}><i className="ri-user-line" />{loading ? '…' : stats.subscribers?.toLocaleString()} players</span>
                  <span className={styles.metaItem}><i className="ri-trophy-line" />{loading ? '…' : stats.tournaments} tournaments</span>
                </div>
                <i className={`ri-arrow-right-line ${styles.arrow}`} />
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
