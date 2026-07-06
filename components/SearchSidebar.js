'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthProvider'
import { useAuthGate } from './AuthGateModal'
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
 *  - clans:       supabase.clans (name AND code — see below)
 *  - shop items:  supabase.shop_items (title, category, price) — active only
 *
 * Clan codes as direct tokens: clans are matched on name OR code
 * substring during normal typing, same as everything else. On top of
 * that, pressing Enter runs a fast exact-match lookup against `code`
 * — if what's typed is (or resolves to) a real clan code, it jumps
 * straight to that clan's page rather than making the person tap a
 * result row. This is the "paste a code, hit enter, land on the exact
 * clan" flow.
 *
 * "Recommended" (shown before the person types anything) surfaces a small
 * live snapshot: the most recent active tournaments + top-ranked players,
 * so it's never fake placeholder content either.
 */
export default function SearchSidebar({ open, onClose }) {
  const router = useRouter()
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const [query, setQuery]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [jumping, setJumping]   = useState(false)
  const [results, setResults]   = useState({ games: [], tournaments: [], players: [], clans: [], shop: [] })
  const [recommended, setRecommended] = useState({ tournaments: [], players: [] })
  const [stories, setStories]         = useState([])
  const [storiesLoading, setStoriesLoading] = useState(false)
  // Which searched/recommended player ids the current user already follows.
  // Absence from the set just means "not following" — we never store false
  // explicitly, so toggling just adds/removes ids.
  const [followingSet, setFollowingSet] = useState(new Set())
  const inputRef  = useRef(null)
  const debounce  = useRef(null)

  // Given a batch of player rows just fetched, look up which of them the
  // current user already follows and merge those ids into followingSet.
  async function hydrateFollowing(players) {
    if (!user || !players?.length) return
    const ids = players.map(p => p.id).filter(id => id !== user.id)
    if (!ids.length) return
    const { data } = await supabase
      .from('follows').select('following_id')
      .eq('follower_id', user.id).in('following_id', ids)
    if (data?.length) {
      setFollowingSet(prev => new Set([...prev, ...data.map(r => r.following_id)]))
    }
  }

  async function toggleFollow(playerId) {
    if (!user) { openAuthGate(); return }
    const isFollowing = followingSet.has(playerId)
    // Optimistic update first, so the button feels instant.
    setFollowingSet(prev => {
      const next = new Set(prev)
      isFollowing ? next.delete(playerId) : next.add(playerId)
      return next
    })
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', playerId)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: playerId })
    }
  }

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
    hydrateFollowing(players || [])
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
      setResults({ games: [], tournaments: [], players: [], clans: [], shop: [] })
      return
    }
    setLoading(true)

    const games = searchGames(q)

    const [{ data: tournaments }, { data: players }, { data: clans }, { data: shop }] = await Promise.all([
      supabase.from('tournaments')
        .select('id, name, game_slug, status, entrance_fee')
        .ilike('name', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.from('profiles')
        .select('id, username, tier, rank, level, avatar_url')
        .ilike('username', `%${q}%`)
        .limit(6),
      supabase.from('clans')
        .select('id, code, name, tag_prefix, game, logo_url, member_count')
        .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
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
      clans: clans || [],
      shop: shop || [],
    })
    setLoading(false)
    hydrateFollowing(players || [])
  }

  function handleChange(e) {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => runSearch(val), 250)
  }

  // Enter = try to jump straight to an exact clan code match, so pasting
  // a code + hitting enter lands on that clan without needing to tap a
  // result row. Falls through silently if nothing matches exactly.
  async function handleKeyDown(e) {
    if (e.key !== 'Enter') return
    const q = query.trim()
    if (!q) return

    // Fast path: already have an exact match in the current results.
    const already = results.clans.find(c => c.code?.toLowerCase() === q.toLowerCase())
    if (already) {
      router.push(`/clans/${already.code}`)
      handleClose()
      return
    }

    setJumping(true)
    const { data: exact } = await supabase
      .from('clans')
      .select('code')
      .ilike('code', q)
      .maybeSingle()
    setJumping(false)

    if (exact) {
      router.push(`/clans/${exact.code}`)
      handleClose()
    }
  }

  function handleClose() {
    setQuery('')
    setResults({ games: [], tournaments: [], players: [], clans: [], shop: [] })
    onClose()
  }

  const hasQuery   = query.trim().length > 0
  const hasResults = results.games.length || results.tournaments.length || results.players.length || results.clans.length || results.shop.length

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
            onKeyDown={handleKeyDown}
            placeholder="Search tournaments, games, clans, users & more"
            className={styles.input}
          />
          {jumping && <span className={styles.jumpingHint}>Jumping…</span>}
          {query && (
            <button className={styles.clearBtn} onClick={() => { setQuery(''); setResults({ games: [], tournaments: [], players: [], clans: [], shop: [] }) }}>
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
                    <PlayerRow key={p.id} p={p} onClick={handleClose} isFollowing={followingSet.has(p.id)} onToggleFollow={toggleFollow} />
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
                    <PlayerRow key={p.id} p={p} onClick={handleClose} isFollowing={followingSet.has(p.id)} onToggleFollow={toggleFollow} />
                  ))}
                </>
              )}

              {results.clans.length > 0 && (
                <>
                  <SectionLabel text="Clans" />
                  {results.clans.map(c => (
                    <ClanRow key={c.id} c={c} onClick={handleClose} />
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

/**
 * NewsStrip — auto-scrolling, infinite-loop horizontal strip of headline
 * cards. Each card shows real media behind a dark gradient fade:
 *   - tournament/chat cards → the game's cover image (GAME_META.image)
 *   - match cards (2 people mentioned) → both avatars, overlapping
 *   - feed post cards → the poster's single avatar
 * Falls back to a plain icon tile if no image is available.
 *
 * Auto-scroll implementation: the story list is rendered twice back-to-back
 * (stories + a duplicate copy), and a requestAnimationFrame loop nudges
 * scrollLeft forward continuously. When scrollLeft passes the width of one
 * full set, it's snapped back by that same width — since the duplicate is
 * pixel-identical, the snap is invisible and the strip *looks* like it
 * scrolls forever. Manual touch/drag pauses the auto-scroll (so it doesn't
 * fight the person's finger) and resumes a moment after they let go.
 */
function NewsStrip({ stories, loading, onClick }) {
  const trackRef   = useRef(null)
  const rafRef      = useRef(null)
  const pausedRef   = useRef(false)
  const resumeTimer = useRef(null)

  useEffect(() => {
    const track = trackRef.current
    if (!track || stories.length === 0) return

    const speed = 0.4 // px per frame, slow/ambient

    function step() {
      if (!pausedRef.current && track) {
        const halfWidth = track.scrollWidth / 2
        track.scrollLeft += speed
        // Once we've scrolled past the first full set, snap back by exactly
        // that width — since set #2 is an identical duplicate of set #1,
        // this is visually seamless.
        if (track.scrollLeft >= halfWidth) {
          track.scrollLeft -= halfWidth
        }
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [stories])

  function pause() {
    pausedRef.current = true
    clearTimeout(resumeTimer.current)
  }
  function resumeSoon() {
    clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => { pausedRef.current = false }, 1200)
  }

  if (!loading && stories.length === 0) return null

  // Duplicate the list so the loop has a seamless second half to scroll into.
  const looped = stories.length > 0 ? [...stories, ...stories] : []

  return (
    <div className={styles.newsSection}>
      <SectionLabel text="Headlines" />
      <div
        ref={trackRef}
        className={styles.newsTrack}
        onPointerDown={pause}
        onPointerUp={resumeSoon}
        onPointerLeave={resumeSoon}
      >
        {loading && stories.length === 0 && (
          <div className={styles.newsCardSkeleton} />
        )}
        {looped.map((s, i) => (
          <Link key={`${s.id}-${i}`} href={s.href} className={styles.newsCard} onClick={onClick}>
            <NewsCardMedia media={s.media} icon={s.icon} />
            <div className={styles.newsCardFade} />
            <div className={styles.newsCardText}>
              <span className={styles.newsCardHeadline}>{s.headline}</span>
              <span className={styles.newsCardSub}>{s.sub}</span>
              <span className={styles.newsCardTime}>{s.timeLabel}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

/** Renders the background media for a headline card: a game cover image,
 *  two overlapping avatars (match winner/loser), a single avatar (feed
 *  post), or a plain icon tile if nothing real is available. */
function NewsCardMedia({ media, icon }) {
  if (media?.kind === 'game' && media.src) {
    return <img src={media.src} alt="" className={styles.newsCardBg} />
  }
  if (media?.kind === 'duo' && (media.a || media.b)) {
    return (
      <div className={styles.newsCardDuo}>
        <div className={styles.newsCardDuoHalf}>
          {media.a
            ? <img src={media.a} alt="" />
            : <div className={styles.newsCardAvatarFallback}><i className="ri-user-3-line" /></div>}
        </div>
        <div className={styles.newsCardDuoHalf}>
          {media.b
            ? <img src={media.b} alt="" />
            : <div className={styles.newsCardAvatarFallback}><i className="ri-user-3-line" /></div>}
        </div>
      </div>
    )
  }
  if (media?.kind === 'avatar' && media.src) {
    return <img src={media.src} alt="" className={styles.newsCardBg} />
  }
  // Fallback: no real image available — plain icon tile
  return (
    <div className={`${styles.newsCardBg} ${styles.newsCardIconFallback}`}>
      <i className={icon} />
    </div>
  )
}

function TournamentRow({ t, onClick }) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const gameName = GAME_META[t.game_slug]?.name || t.game_slug
  const href = `/tournaments/${t.id}`
  const ctaLabel = t.status === 'active' ? 'Join' : 'View'

  function shareLink(e) {
    e.stopPropagation()
    const url = `${window.location.origin}${href}`
    navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={styles.resultRow} onClick={() => { router.push(href); onClick?.() }}>
      <div className={styles.resultIcon}><i className="ri-trophy-line" /></div>
      <div className={styles.resultMeta}>
        <span className={styles.resultTitle}>{t.name}</span>
        <span className={styles.resultSub}>{gameName} · {t.status}</span>
      </div>
      <div className={styles.resultCtaGroup}>
        <button className={styles.resultCtaSecondary} onClick={shareLink}>
          {copied ? 'Copied' : 'Share'}
        </button>
        <Link href={href} className={styles.resultCta} onClick={(e) => { e.stopPropagation(); onClick?.() }}>
          {ctaLabel}
        </Link>
      </div>
    </div>
  )
}

function ClanRow({ c, onClick }) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const gameName = GAME_META[c.game]?.name || c.game
  const href = `/clans/${c.code}`

  function copyCode(e) {
    e.stopPropagation()
    navigator.clipboard?.writeText(c.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={styles.resultRow} onClick={() => { router.push(href); onClick?.() }}>
      <div className={styles.resultIcon}>
        {c.logo_url
          ? <img src={c.logo_url} alt="" className={styles.resultAvatar} />
          : <i className="ri-shield-star-line" />
        }
      </div>
      <div className={styles.resultMeta}>
        <span className={styles.resultTitle}>
          {c.name} <span className={styles.clanTagChip}>{c.tag_prefix}</span>
        </span>
        <span className={styles.resultSub}>{gameName} · {c.member_count} members · code {c.code}</span>
      </div>
      <div className={styles.resultCtaGroup}>
        <button className={styles.resultCtaSecondary} onClick={copyCode}>
          {copied ? 'Copied' : 'Copy Code'}
        </button>
        <Link href={href} className={styles.resultCta} onClick={(e) => { e.stopPropagation(); onClick?.() }}>
          View
        </Link>
      </div>
    </div>
  )
}

function PlayerRow({ p, onClick, isFollowing, onToggleFollow }) {
  const router = useRouter()
  const href = `/profile/${p.id}`
  return (
    <div className={styles.resultRow} onClick={() => { router.push(href); onClick?.() }}>
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
      <div className={styles.resultCtaGroup}>
        <button
          className={isFollowing ? styles.resultCtaSecondary : styles.resultCta}
          onClick={(e) => { e.stopPropagation(); onToggleFollow?.(p.id) }}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </button>
        <Link href={href} className={styles.resultCtaSecondary} onClick={(e) => { e.stopPropagation(); onClick?.() }}>
          View
        </Link>
      </div>
    </div>
  )
}
