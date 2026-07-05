import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { pickFeedSolo, pickChatSolo, pickExchange } from '../../../../lib/seedContent'

const SUPABASE_URL = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function delay(ms) { return new Promise(res => setTimeout(res, ms)) }

async function getPersonas() {
  const { data } = await supabaseAdmin.from('profiles').select('id, username').eq('bot_type', 'social')
  return data || []
}

async function postFeedSolo(personas) {
  const persona = pick(personas)
  const content = pickFeedSolo()
  await supabaseAdmin.from('posts').insert({ user_id: persona.id, content, likes: 0, comment_count: 0 })
  return { kind: 'feed_solo', persona: persona.username, content }
}

async function postChatSolo(personas) {
  const persona = pick(personas)
  const { gameSlug, body } = pickChatSolo()
  await supabaseAdmin.from('game_chat_messages').insert({ game_slug: gameSlug, sender_id: persona.id, body, msg_type: 'text' })
  return { kind: 'chat_solo', persona: persona.username, gameSlug, body }
}

async function postFeedExchange(personas) {
  if (personas.length < 2) return postFeedSolo(personas)
  const shuffled = [...personas].sort(() => Math.random() - 0.5)
  const [personaA, personaB] = shuffled
  const { a, b } = pickExchange()
  await supabaseAdmin.from('posts').insert({ user_id: personaA.id, content: a, likes: 0, comment_count: 0 })
  await delay(300)
  await supabaseAdmin.from('posts').insert({ user_id: personaB.id, content: b, likes: 0, comment_count: 0 })
  return { kind: 'feed_exchange', a: { persona: personaA.username, content: a }, b: { persona: personaB.username, content: b } }
}

async function postChatExchange(personas) {
  if (personas.length < 2) return postChatSolo(personas)
  const shuffled = [...personas].sort(() => Math.random() - 0.5)
  const [personaA, personaB] = shuffled
  const { gameSlug, a, b } = pickExchange()
  await supabaseAdmin.from('game_chat_messages').insert({ game_slug: gameSlug, sender_id: personaA.id, body: a, msg_type: 'text' })
  await delay(300)
  await supabaseAdmin.from('game_chat_messages').insert({ game_slug: gameSlug, sender_id: personaB.id, body: b, msg_type: 'text' })
  return { kind: 'chat_exchange', gameSlug, a: { persona: personaA.username, content: a }, b: { persona: personaB.username, content: b } }
}

const ACTIVITY_TYPES = {
  feed: [postFeedSolo, postFeedExchange],
  chat: [postChatSolo, postChatExchange],
  mix:  [postFeedSolo, postFeedExchange, postChatSolo, postChatExchange],
}

/**
 * GET /api/cron/seed-activity
 *
 * Two ways in:
 *  - Vercel Cron hits this on a schedule (see vercel.json) with the
 *    Authorization: Bearer CRON_SECRET header it adds automatically.
 *    On a cron hit there's a random chance the run does nothing at all,
 *    so activity doesn't look like it's firing on a suspiciously exact
 *    clock tick.
 *  - You trigger it manually with ?secret=ADMIN_SEED_SECRET&force=true
 *    whenever you want an immediate burst (e.g. before showing someone
 *    the app). Manual calls always post — no random skip.
 *
 * Query params (manual calls only):
 *   type   'feed' | 'chat' | 'mix'  (default 'mix')
 *   count  how many activities to post in this call (default 1, max 5)
 *   force  skip the random-skip chance
 */
export async function GET(request) {
  try {
    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const authHeader = request.headers.get('authorization')
    const isCron   = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
    const isManual = process.env.ADMIN_SEED_SECRET && searchParams.get('secret') === process.env.ADMIN_SEED_SECRET

    if (!isCron && !isManual) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const type  = ['feed', 'chat', 'mix'].includes(searchParams.get('type')) ? searchParams.get('type') : 'mix'
    const count = Math.min(Number(searchParams.get('count')) || 1, 5)
    const force = isManual && searchParams.get('force') === 'true'

    // Cron calls skip themselves ~55% of the time so activity doesn't look
    // like it's firing on a perfectly even clock — manual calls always run.
    if (isCron && !force && Math.random() < 0.55) {
      return NextResponse.json({ success: true, skipped: true })
    }

    const personas = await getPersonas()
    if (!personas.length) {
      return NextResponse.json({ error: 'No social personas found — run /api/admin/seed-social-bots first' }, { status: 400 })
    }

    const pool = ACTIVITY_TYPES[type]
    const results = []
    for (let i = 0; i < count; i++) {
      const fn = pick(pool)
      results.push(await fn(personas))
    }

    return NextResponse.json({ success: true, posted: results.length, results })
  } catch (err) {
    console.error('seed-activity error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
