import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SUPABASE_URL = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Give this route the full 60s Vercel allows on Hobby, since deleting many
// bots' auth.users rows one-by-one (the Admin API has no bulk-delete) is
// the slow part and can't be batched away.
export const maxDuration = 60

/**
 * GET /api/admin/delete-test-bots?secret=YOUR_ADMIN_SEED_SECRET
 *
 * Full teardown for bot accounts — the mirror image of seed-test-bots.
 * Deleting a profiles row does NOT delete its matching auth.users row (see
 * delete-account/route.js, which calls both separately) — so a plain SQL
 * `delete from profiles where is_bot = true` leaves orphaned auth users
 * behind. If you re-run seed-test-bots later, it'll try to reuse the same
 * botN@bots.nabogaming.internal emails and fail with "already registered".
 *
 * PERFORMANCE NOTE: this used to loop per-bot × per-table (bots × 22 tables
 * = 2,500+ sequential round-trips with 116 bots), which blew past Vercel's
 * function time limit and just hung until it got killed. Now each
 * dependent table is cleared ONCE for all bot ids at once via `.in()`, so
 * it's 22 table deletes total + one bulk profiles delete, run in parallel.
 * The only unavoidable per-bot loop left is deleting auth.users, since
 * Supabase's Admin API has no bulk-delete for that.
 */
export async function GET(request) {
  try {
    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    if (!process.env.ADMIN_SEED_SECRET || secret !== process.env.ADMIN_SEED_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Two separate queries merged together, instead of one .or() string —
    // .or() takes a raw PostgREST filter string and special characters like
    // % and @ inside an ilike pattern can get mis-parsed, silently matching
    // nothing for that half of the filter (which is exactly what happened:
    // is_bot=true bots were found, but email-matched bots were not).
    const [{ data: byIsBot, error: err1 }, { data: byEmail, error: err2 }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, username, email, is_bot').eq('is_bot', true),
      supabaseAdmin.from('profiles').select('id, username, email, is_bot').ilike('email', '%@bots.nabogaming.internal'),
    ])

    if (err1) throw err1
    if (err2) throw err2

    const mergedById = new Map()
    for (const b of byIsBot || []) mergedById.set(b.id, b)
    for (const b of byEmail || []) mergedById.set(b.id, b)
    const bots = Array.from(mergedById.values())

    const matchedByIsBot = (byIsBot || []).length
    const matchedByEmailOnly = bots.length - matchedByIsBot

    if (!bots || bots.length === 0) {
      return NextResponse.json({ success: true, deletedCount: 0, deleted: [], matchedByIsBot, matchedByEmailOnly, errors: [] })
    }

    const botIds = bots.map(b => b.id)
    const tableErrors = []

    const dependentTables = [
      { table: 'tournament_leaderboard',   col: 'user_id'       },
      { table: 'tournament_participants',  col: 'user_id'       },
      { table: 'tournament_payments',      col: 'user_id'       },
      { table: 'notifications',            col: 'user_id'       },
      { table: 'follows',                  col: 'follower_id'   },
      { table: 'follows',                  col: 'following_id'  },
      { table: 'earnings_log',             col: 'user_id'       },
      { table: 'achievements',             col: 'user_id'       },
      { table: 'season_history',           col: 'user_id'       },
      { table: 'comments',                 col: 'user_id'       },
      { table: 'post_likes',               col: 'user_id'       },
      { table: 'posts',                    col: 'user_id'       },
      { table: 'negotiation_messages',     col: 'sender_id'     },
      { table: 'buy_requests',             col: 'buyer_id'      },
      { table: 'buy_requests',             col: 'seller_id'     },
      { table: 'game_chat_messages',       col: 'sender_id'     },
      { table: 'direct_messages',          col: 'sender_id'     },
      { table: 'direct_messages',          col: 'receiver_id'   },
      { table: 'score_requests',           col: 'requester_id'  },
      { table: 'score_requests',           col: 'opponent_id'   },
      { table: 'game_subscriptions',       col: 'user_id'       },
      { table: 'shop_items',               col: 'seller_id'     },
      { table: 'matches',                  col: 'challenger_id' },
      { table: 'matches',                  col: 'challenged_id' },
    ]

    // One batched delete per table (all bot ids at once) instead of one
    // per bot — this is the change that fixes the hang.
    await Promise.all(dependentTables.map(async ({ table, col }) => {
      const { error } = await supabaseAdmin.from(table).delete().in(col, botIds)
      if (error && !error.message.includes('does not exist')) {
        tableErrors.push({ table, col, message: error.message })
      }
    }))

    // Bulk-delete all profiles rows in one call.
    const { error: profileErr } = await supabaseAdmin.from('profiles').delete().in('id', botIds)
    if (profileErr) throw profileErr

    // auth.users has no bulk-delete in the Admin API, so this loop is
    // unavoidable — but it's only ~116 calls now, not ~2,500.
    const deleted = []
    const errors = [...tableErrors]
    for (const bot of bots) {
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(bot.id)
      if (authErr) { errors.push({ id: bot.id, username: bot.username, step: 'auth', message: authErr.message }); continue }
      deleted.push(bot.username)
    }

    return NextResponse.json({
      success: true,
      deletedCount: deleted.length,
      deleted,
      matchedByIsBot,
      matchedByEmailOnly,
      errors,
    })
  } catch (err) {
    console.error('delete-test-bots error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
