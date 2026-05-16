import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Pull URL and anon key directly from the same constants lib uses
const SUPABASE_URL     = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0'

// Service role key — add SUPABASE_SERVICE_ROLE_KEY to .env.local / Vercel env vars
// Get it from: Supabase Dashboard → Project Settings → API → service_role (secret)
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Admin client — can delete auth.users (server-side only, never sent to browser)
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Anon client — only used to verify the user's JWT
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export async function POST(request) {
  try {
    // 1. Verify the user's session token from Authorization header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const uid = user.id

    // 2. Delete shop images first (FK dependency on shop_items)
    const { data: myItems } = await supabaseAdmin
      .from('shop_items')
      .select('id')
      .eq('seller_id', uid)

    if (myItems?.length) {
      const itemIds = myItems.map(i => i.id)
      await supabaseAdmin.from('shop_item_images').delete().in('item_id', itemIds)
      await supabaseAdmin.from('shop-images').delete().in('item_id', itemIds)
    }

    // 3. Delete all user data in dependency order
    const tables = [
      { table: 'comments',                 col: 'user_id'       },
      { table: 'post_likes',               col: 'user_id'       },
      { table: 'posts',                    col: 'user_id'       },
      { table: 'notifications',            col: 'user_id'       },
      { table: 'follows',                  col: 'follower_id'   },
      { table: 'follows',                  col: 'following_id'  },
      { table: 'earnings_log',             col: 'user_id'       },
      { table: 'achievements',             col: 'user_id'       },
      { table: 'season_history',           col: 'user_id'       },
      { table: 'tournament_leaderboard',   col: 'user_id'       },
      { table: 'tournament_participants',  col: 'user_id'       },
      { table: 'tournament_payments',      col: 'user_id'       },
      { table: 'negotiation_messages',     col: 'sender_id'     },
      { table: 'buy_requests',             col: 'buyer_id'      },
      { table: 'buy_requests',             col: 'seller_id'     },
      { table: 'game_chat_messages',       col: 'user_id'       },
      { table: 'direct_messages',          col: 'sender_id'     },
      { table: 'direct_messages',          col: 'receiver_id'   },
      { table: 'score_requests',           col: 'requester_id'  },
      { table: 'score_requests',           col: 'opponent_id'   },
      { table: 'game_subscriptions',       col: 'user_id'       },
      { table: 'shop_items',               col: 'seller_id'     },
      { table: 'matches',                  col: 'challenger_id' },
      { table: 'matches',                  col: 'challenged_id' },
    ]

    for (const { table, col } of tables) {
      const { error } = await supabaseAdmin.from(table).delete().eq(col, uid)
      if (error && !error.message.includes('does not exist') && !error.message.includes('no rows')) {
        console.warn(`Warning deleting ${table}.${col}:`, error.message)
      }
    }

    // 4. Delete profile row
    await supabaseAdmin.from('profiles').delete().eq('id', uid)

    // 5. Delete the auth user — requires service_role, impossible from client-side
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(uid)
    if (deleteAuthError) {
      return NextResponse.json({ error: 'Auth delete failed: ' + deleteAuthError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('delete-account error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
