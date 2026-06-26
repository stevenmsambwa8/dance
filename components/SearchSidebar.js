'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../lib/constants'
import { getRecentStories } from '../lib/news'
import styles from './SearchSidebar.module.css'

/**
 * SearchSidebar — full-cover, friendly search overlay.
 *
 * Design intent (per request): NOT a redirect-to-/search-page pattern.
 * Opening it slides a full-cover panel over the current screen; typing
 * searches in place and renders results inline as cards the person can
 * tap (which navigates to that result's real page — but the *act of
 * searching* never leaves this panel or reloads anything).
 *
 * Data sources are real, not mocked:
 *  - games:       static GAME_META list (matched client-side, it's small)
 *  - tournaments: supabase.tournaments (name, game_slug, status)
 *  - players:     supabase.profiles (username, tier, rank)
 *  - shop items:  supabase.shop_items (title, category, price) — active only
 *
 * "Recommended" (shown before the person types anything) surfaces a small
 * live snapshot: the most recent active tournaments + top-ranked players,
 * so it's never fake placeholder content either.
 */
export default function SearchSidebar({ open, onClose }) {
  const [query, setQuery]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [results, setResults]   = useState({ games: [], tournaments: [], players: [], shop: [] })
  const [recommended, setRecommended] = useState({ tournaments: [], players: [] })
  const [stories, setStories]         = useState([])
  const [storiesLoading, setStoriesLoading] = useState(false)
  const inputRef  = useRef(null)
  const debounce  = useRef(null)

  // Focus input + load recommendations the moment the panel opens
  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 50)
    loadRecommended()
    loadStories()
  }, [open])

  // Lock body scroll while the panel is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  // Esc to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function loadRecommended() {
    const [{ data: tournaments }, { data: players }] = await Promise.all([
      supabase.from('tournaments').select('id, name, game_slug, status, entrance_fee')
        .eq('status', 'active').order('created_at', { ascending: false }).limit(4),
      supabase.from('profiles').select('id, username, tier, rank, level, avatar_url')
        .order('level', { ascending: false }).limit(4),
    ])
    setRecommended({ tournaments: tournaments || [], players: players || [] })
  }

  async function loadStories() {
    setStoriesLoading(true)
    const data = await getRecentStories(4)
    setStories(data)
    setStoriesLoading(false)
  }

  function searchGames(q) {
    const needle = q.toLowerCase()
    return GAME_SLUGS
      .filter(slug => {
        const m = GAME_META[slug]
        return m.name.toLowerCase().includes(needle) ||
               m.full.toLowerCase().includes(needle) ||
               m.genre.toLowerCase().includes(needle)
      })
      .map(slug => ({ slug, ...GAME_META[slug] }))
      .slice(0, 6)
  }

  async function runSearch(q) {
    if (!q.trim()) {
      setResults({ games: [], tournaments: [], players: [], shop: [] })
      return
    }
    setLoading(true)

    const games = searchGames(q)

    const [{ data: tournaments }, { data: players }, { data: shop }] = await Promise.all([
      supabase.from('tournaments')
        .select('id, name, game_slug, status, entrance_fee')
        .ilike('name', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.from('profiles')
        .select('id, username, tier, rank, level, avatar_url')
        .ilike('username', `%${q}%`)
        .limit(6),
      supabase.from('shop_items')
        .select('id, title, price, category, active')
        .ilike('title', `%${q}%`)
        .eq('active', true)
        .limit(6),
    ])

    setResults({
      games,
      tournaments: tournaments || [],
      players: players || [],
      shop: shop || [],
    })
    setLoading(false)
  }

  function handleChange(e) {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => runSearch(val), 250)
  }

  function handleClose() {
    setQuery('')
    setResults({ games: [], tournaments: [], players: [], shop: [] })
    onClose()
  }

  const hasQuery   = query.trim().length > 0
  const hasResults = results.games.length || results.tournaments.length || results.players.length || results.shop.length

  if (!open) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        {/* ── Search bar header ── */}
        <div className={styles.header}>
          <i className="ri-search-line" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleChange}
            placeholder="Search anything…"
            className={styles.input}
          />
          {query && (
            <button className={styles.clearBtn} onClick={() => { setQuery(''); setResults({ games: [], tournaments: [], players: [], shop: [] }) }}>
              <i className="ri-close-circle-fill" />
            </button>
          )}
          <button className={styles.closeBtn} onClick={handleClose}>
            <i className="ri-close-line" />
          </button>
        </div>

        <div className={styles.body}>
          {/* ── Before typing: friendly recommended snapshot ── */}
          {!hasQuery && (
            <>
              <NewsStrip stories={stories} loading={storiesLoading} onClick={handleClose} />

              <SectionLabel text="Browse games" />
              <div className={styles.gameGrid}>
                {GAME_SLUGS.map(slug => (
                  <Link key={slug} href={`/games/${slug}`} className={styles.gameChip} onClick={handleClose}>
                    <i className={GAME_META[slug].icon} />
                    <span>{GAME_META[slug].name}</span>
                  </Link>
                ))}
              </div>

              {recommended.tournaments.length > 0 && (
                <>
                  <SectionLabel text="Active tournaments" />
                  {recommended.tournaments.map(t => (
                    <TournamentRow key={t.id} t={t} onClick={handleClose} />
                  ))}
                </>
              )}

              {recommended.players.length > 0 && (
                <>
                  <SectionLabel text="Top players" />
                  {recommended.players.map(p => (
                    <PlayerRow key={p.id} p={p} onClick={handleClose} />
                  ))}
                </>
              )}
            </>
          )}

          {/* ── While typing: live results ── */}
          {hasQuery && (
            <>
              {loading && <div className={styles.statusText}>Searching…</div>}

              {!loading && !hasResults && (
                <div className={styles.statusText}>
                  No results for &ldquo;{query}&rdquo;
                </div>
              )}

              {results.games.length > 0 && (
                <>
                  <SectionLabel text="Games" />
                  <div className={styles.gameGrid}>
                    {results.games.map(g => (
                      <Link key={g.slug} href={`/games/${g.slug}`} className={styles.gameChip} onClick={handleClose}>
                        <i className={g.icon} />
                        <span>{g.name}</span>
                      </Link>
                    ))}
                  </div>
                </>
              )}

              {results.tournaments.length > 0 && (
                <>
                  <SectionLabel text="Tournaments" />
                  {results.tournaments.map(t => (
                    <TournamentRow key={t.id} t={t} onClick={handleClose} />
                  ))}
                </>
              )}

              {results.players.length > 0 && (
                <>
                  <SectionLabel text="Players" />
                  {results.players.map(p => (
                    <PlayerRow key={p.id} p={p} onClick={handleClose} />
                  ))}
                </>
              )}

              {results.shop.length > 0 && (
                <>
                  <SectionLabel text="Shop" />
                  {results.shop.map(s => (
                    <Link key={s.id} href={`/shop/${s.id}`} className={styles.resultRow} onClick={handleClose}>
                      <div className={styles.resultIcon}><i className="ri-store-2-line" /></div>
                      <div className={styles.resultMeta}>
                        <span className={styles.resultTitle}>{s.title}</span>
                        <span className={styles.resultSub}>{s.category} · TZS {Number(s.price).toLocaleString()}</span>
                      </div>
                      <i className={`ri-arrow-right-s-line ${styles.resultArrow}`} />
                    </Link>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ text }) {
  return <div className={styles.sectionLabel}>{text}</div>
}

function NewsStrip({ stories, loading, onClick }) {
  if (!loading && stories.length === 0) return null

  return (
    <div className={styles.newsSection}>
      <SectionLabel text="Headlines" />
      <div className={styles.newsTrack}>
        {loading && stories.length === 0 && (
          <div className={styles.newsCardSkeleton} />
        )}
        {stories.map(s => (
          <Link key={s.id} href={s.href} className={styles.newsCard} onClick={onClick}>
            <div className={styles.newsCardIcon}><i className={s.icon} /></div>
            <span className={styles.newsCardHeadline}>{s.headline}</span>
            <span className={styles.newsCardSub}>{s.sub}</span>
            <span className={styles.newsCardTime}>{s.timeLabel}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function TournamentRow({ t, onClick }) {
  const gameName = GAME_META[t.game_slug]?.name || t.game_slug
  return (
    <Link href={`/tournaments/${t.id}`} className={styles.resultRow} onClick={onClick}>
      <div className={styles.resultIcon}><i className="ri-trophy-line" /></div>
      <div className={styles.resultMeta}>
        <span className={styles.resultTitle}>{t.name}</span>
        <span className={styles.resultSub}>{gameName} · {t.status}</span>
      </div>
      <i className={`ri-arrow-right-s-line ${styles.resultArrow}`} />
    </Link>
  )
}

function PlayerRow({ p, onClick }) {
  return (
    <Link href={`/profile/${p.id}`} className={styles.resultRow} onClick={onClick}>
      <div className={styles.resultIcon}>
        {p.avatar_url
          ? <img src={p.avatar_url} alt="" className={styles.resultAvatar} />
          : <i className="ri-user-3-line" />
        }
      </div>
      <div className={styles.resultMeta}>
        <span className={styles.resultTitle}>{p.username}</span>
        <span className={styles.resultSub}>{p.tier || 'Unranked'} · Lv.{p.level ?? '—'}</span>
      </div>
      <i className={`ri-arrow-right-s-line ${styles.resultArrow}`} />
    </Link>
  )
}
