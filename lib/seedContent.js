// lib/seedContent.js
//
// Content bank for the social seeding system (feed posts + game chat).
// Two shapes of content:
//  - SOLO: a single line posted by one persona
//  - EXCHANGE: a short back-and-forth between two personas, posted a few
//    seconds apart so it reads as a real reply, not a copy-paste dump
//
// Keep this data-only (no logic) so adding/editing lines never touches the
// posting engine in app/api/cron/seed-activity/route.js.

import { GAME_SLUGS, GAME_META } from './constants'

export const FEED_SOLO = [
  "Anyone else's ping been terrible tonight or is it just me? 😩",
  "Finally hit a new personal best win streak. Small wins 🏆",
  "PSA: check the tournament page, a few slots just opened up for tonight's bracket.",
  "Rate my loadout in the comments 👇",
  "Who's grinding for the season reset this week?",
  "That last match had no business being that close. GG to whoever I just played.",
  "Reminder: squad up before you queue, solo queue is rough out there right now.",
  "Anyone free for a quick 1v1 in the next hour?",
  "Been playing since the app first dropped, love watching this community grow 🔥",
  "What's everyone's go-to warm-up routine before a tournament match?",
]

export const CHAT_SOLO = [
  "yo anyone up for a match right now?",
  "that was such a close game 😭 GG",
  "who's the best {game} player in here fr",
  "need one more for a full squad, anyone free?",
  "just hit a new rank, feeling good 🔥",
  "anyone know when the next tournament drops?",
  "lag is unbearable rn, anyone else?",
  "who wants to run it back after that loss",
  "quick tip: aim for headshots first few seconds of a fight, saves so much time",
  "gg everyone that was a fun lobby",
]

// {a} speaks first, {b} replies a few seconds later — both use {game}
// where relevant so it reads as belonging to that game's chat room.
export const EXCHANGES = [
  { a: "bro your squad got cooked yesterday 😂", b: "rematch anytime, that was one bad round lol" },
  { a: "anyone else think the new update changed the recoil?", b: "yeah feels different, still adjusting ngl" },
  { a: "who's carrying the squad tonight", b: "not gonna be you after last time 💀" },
  { a: "just watched a insane clip in the {game} community tab", b: "link it! always down to see good plays" },
  { a: "is it me or ranked feels harder this season", b: "fr the sbmm has been rough ngl" },
  { a: "anyone want to run a scrim before the tournament?", b: "yeah I'm down, give me 10 min" },
  { a: "that tournament bracket looks stacked this week", b: "yeah saw a few clan teams signed up too" },
  { a: "L take but {game} mobile controls > controller", b: "that is absolutely an L take 😂 but respect the confidence" },
]

const PLACEHOLDER_GAME = () => {
  const slug = GAME_SLUGS[Math.floor(Math.random() * GAME_SLUGS.length)]
  return { slug, name: GAME_META[slug]?.name || slug }
}

export function pickFeedSolo() {
  return FEED_SOLO[Math.floor(Math.random() * FEED_SOLO.length)]
}

export function pickChatSolo() {
  const { slug, name } = PLACEHOLDER_GAME()
  const line = CHAT_SOLO[Math.floor(Math.random() * CHAT_SOLO.length)]
  return { gameSlug: slug, body: line.replace('{game}', name) }
}

export function pickExchange() {
  const { slug, name } = PLACEHOLDER_GAME()
  const ex = EXCHANGES[Math.floor(Math.random() * EXCHANGES.length)]
  return {
    gameSlug: slug,
    a: ex.a.replace('{game}', name),
    b: ex.b.replace('{game}', name),
  }
}
