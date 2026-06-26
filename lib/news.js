import { supabase } from './supabase'
import { GAME_META } from './constants'

/**
 * lib/news.js — extracts real "headlines" from live site activity, written
 * tabloid/sports-broadcast style (dramatic, ALL-CAPS verbs, urgency) rather
 * than flat description.
 *
 * This mirrors exactly what the admin dashboard already queries
 * (app/dashboard/page.js uses the same tables: tournaments, matches,
 * posts, game_chat_messages) — nothing here is mocked, only the *tone* of
 * the copy is stylized. Each function pulls a small recent slice and
 * normalizes it into a common shape:
 *
 *   { id, type, headline, sub, href, icon, at }
 *
 * so the UI can render any mix of story types in one feed without
 * needing to know which table it came from.
 */

function gameName(slug) {
  return GAME_META[slug]?.name || slug
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins   = Math.floor(diffMs / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/** Score-margin-aware verb picks for match headlines — bigger blowouts get
 *  louder language, close ones get "survives"/"edges out" instead. */
function matchVerb(scoreDiff) {
  if (scoreDiff >= 5) return ['DESTROYED', 'DEMOLISHED', 'OBLITERATED'][Math.floor(Math.random() * 3)]
  if (scoreDiff >= 2) return ['CRUSHED', 'TOOK DOWN', 'OUTPLAYED'][Math.floor(Math.random() * 3)]
  return ['EDGED OUT', 'SURVIVED', 'CLIPPED'][Math.floor(Math.random() * 3)]
}

/** Recently completed matches with a declared winner. */
async function completedMatchStories(limit) {
  const { data } = await supabase
    .from('matches')
    .select(`
      id, game, status, winner_id, score_challenger, score_challenged, created_at,
      challenger:profiles!matches_challenger_id_fkey(id, username),
      challenged:profiles!matches_challenged_id_fkey(id, username)
    `)
    .eq('status', 'completed')
    .not('winner_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data || []).map(m => {
    const winnerName = m.winner_id === m.challenger?.id ? m.challenger?.username
                      : m.winner_id === m.challenged?.id ? m.challenged?.username
                      : null
    const loserName  = m.winner_id === m.challenger?.id ? m.challenged?.username
                      : m.challenger?.username
    if (!winnerName) return null

    const sc   = Number(m.score_challenger ?? 0)
    const sd   = Number(m.score_challenged ?? 0)
    const diff = Math.abs(sc - sd)
    const verb = matchVerb(diff)

    return {
      id:       `match-${m.id}`,
      type:     'match',
      headline: `${winnerName.toUpperCase()} ${verb} ${(loserName || 'AN OPPONENT').toUpperCase()}`,
      sub:      `${gameName(m.game)} · Final score ${sc}–${sd}`,
      href:     `/matches/${m.id}`,
      icon:     'ri-sword-line',
      at:       m.created_at,
    }
  }).filter(Boolean)
}

/** Newly created / currently active tournaments. */
async function tournamentStories(limit) {
  const { data } = await supabase
    .from('tournaments')
    .select('id, name, game_slug, status, entrance_fee, created_at')
    .in('status', ['active', 'open', 'recruiting'])
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data || []).map(t => {
    const free = !t.entrance_fee || Number(t.entrance_fee) === 0
    return {
      id:       `tourney-${t.id}`,
      type:     'tournament',
      headline: `🔥 ${t.name.toUpperCase()} IS LIVE`,
      sub:      `${gameName(t.game_slug)} · ${free ? 'Free entry — slots filling fast' : 'Entry open — don\'t miss it'}`,
      href:     `/tournaments/${t.id}`,
      icon:     'ri-trophy-line',
      at:       t.created_at,
    }
  })
}

/** Most recently active per-game group chats — a busy chat is news. */
async function gameChatStories(limit) {
  // Pull a recent slice of messages across all games, then collapse to the
  // single latest message per game (mirrors what a "trending chat" feels
  // like without needing a dedicated aggregate table).
  const { data } = await supabase
    .from('game_chat_messages')
    .select('id, game_slug, body, sender_id, created_at, profiles(username)')
    .order('created_at', { ascending: false })
    .limit(limit * 6) // overfetch, then collapse per-game below

  const seenGames = new Set()
  const stories = []
  for (const msg of data || []) {
    if (seenGames.has(msg.game_slug)) continue
    seenGames.add(msg.game_slug)
    const senderName = msg.profiles?.username || 'A player'
    const bodyPreview = (msg.body || '').slice(0, 60)
    stories.push({
      id:       `chat-${msg.id}`,
      type:     'chat',
      headline: `${gameName(msg.game_slug).toUpperCase()} CHAT IS HEATING UP`,
      sub:      `${senderName}: "${bodyPreview || 'New message'}"`,
      href:     `/games/${msg.game_slug}/chat`,
      icon:     'ri-discuss-line',
      at:       msg.created_at,
    })
    if (stories.length >= limit) break
  }
  return stories
}

/** Recent feed posts — community activity. */
async function feedPostStories(limit) {
  const { data } = await supabase
    .from('posts')
    .select('id, content, likes, comment_count, created_at, profiles(username)')
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data || []).map(p => ({
    id:       `post-${p.id}`,
    type:     'post',
    headline: `${(p.profiles?.username || 'SOMEONE').toUpperCase()} JUST DROPPED A POST`,
    sub:      (p.content || '').slice(0, 60) || `${p.likes || 0} likes already`,
    href:     `/feed`,
    icon:     'ri-compass-3-line',
    at:       p.created_at,
  }))
}

/**
 * getRecentStories — the single entry point the UI calls.
 * Pulls a small slice from each real activity source in parallel,
 * merges them, and sorts by recency so the strip reads as one timeline
 * regardless of which table a story actually came from.
 */
export async function getRecentStories(limitPerSource = 4) {
  const [matches, tournaments, chats, posts] = await Promise.all([
    completedMatchStories(limitPerSource).catch(() => []),
    tournamentStories(limitPerSource).catch(() => []),
    gameChatStories(limitPerSource).catch(() => []),
    feedPostStories(limitPerSource).catch(() => []),
  ])

  return [...matches, ...tournaments, ...chats, ...posts]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .map(story => ({ ...story, timeLabel: timeAgo(story.at) }))
}
