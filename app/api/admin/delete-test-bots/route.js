import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SUPABASE_URL = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

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
 * This route removes both sides cleanly:
 *  1. Any tournament_participants rows for each bot
 *  2. The profiles row
 *  3. The auth.users row
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

    const { data: bots, error: findErr } = await supabaseAdmin
      .from('profiles')
      .select('id, username, email, is_bot')
      .or('is_bot.eq.true,email.ilike.%@bots.nabogaming.internal')

    if (findErr) throw findErr

    // Diagnostics — helps pinpoint whether is_bot is actually being set/read
    // correctly, without needing direct DB access to check.
    const matchedByIsBot = (bots || []).filter(b => b.is_bot === true).length
    const matchedByEmailOnly = (bots || []).filter(b => b.is_bot !== true).length

    const deleted = []
    const errors = []

    // Same dependency-safe table list as app/api/delete-account/route.js —
    // a bot can pick up rows in any of these once it's played in a test
    // tournament (results, notifications, earnings, leaderboard entries).
    // Skipping any of them means the profiles delete below fails on a
    // foreign key constraint and the bot silently survives.
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

    for (const bot of bots || []) {
      for (const { table, col } of dependentTables) {
        const { error } = await supabaseAdmin.from(table).delete().eq(col, bot.id)
        if (error && !error.message.includes('does not exist')) {
          console.warn(`delete-test-bots: warning clearing ${table}.${col} for ${bot.id}:`, error.message)
        }
      }

      const { error: profileErr } = await supabaseAdmin.from('profiles').delete().eq('id', bot.id)
      if (profileErr) { errors.push({ id: bot.id, step: 'profile', message: profileErr.message }); continue }

      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(bot.id)
      if (authErr) { errors.push({ id: bot.id, step: 'auth', message: authErr.message }); continue }

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
