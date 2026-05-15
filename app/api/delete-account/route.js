import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Server-side only — uses service_role key which can delete auth.users
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Regular client to verify the user's session
const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  try {
    // 1. Get the Authorization header from the client
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // 2. Verify the token and get the user
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const uid = user.id

    // 3. Delete all user data from public tables (in dependency order)
    const tables = [
      { table: 'post_likes',               col: 'user_id' },
      { table: 'comments',      
      col: 'user_id' },
      { table: 'posts',                    col: 'user_id' },
      { table: 'notifications',            col: 'user_id' },
      { table: 'follows',                  col: 'follower_id' },
      { table: 'follows',                  col: 'following_id' },
      { table: 'earnings_log',             col: 'user_id' },
      { table: 'wallets',                  col: 'user_id' },
      { table: 'achievements',             col: 'user_id' },
      { table: 'season_history',           col: 'user_id' },
      { table: 'tournament_leaderboard',   col: 'user_id' },
      { table: 'tournament_participants',  col: 'user_id' },
      { table: 'buy_requests',             col: 'buyer_id'  },
      { table: 'buy_requests',             col: 'seller_id' },
      { table: 'direct_messages',          col: 'sender_id'   },
      { table: 'direct_messages',          col: 'receiver_id' },
      { table: 'matches',                  col: 'challenger_id' },
      { table: 'matches',                  col: 'challenged_id' },
    ]

    // Delete shop item images first (FK to shop_items)
    const { data: myItems } = await supabaseAdmin
      .from('shop_items')
      .select('id')
      .eq('seller_id', uid)

    if (myItems?.length) {
      const itemIds = myItems.map(i => i.id)
      await supabaseAdmin.from('shop_item_images').delete().in('item_id', itemIds)
    }
    await supabaseAdmin.from('shop_items').delete().eq('seller_id', uid)

    // Delete all other tables
    for (const { table, col } of tables) {
      const { error } = await supabaseAdmin.from(table).delete().eq(col, uid)
      // Ignore errors for tables that might not exist
      if (error && !error.message.includes('does not exist')) {
        console.warn(`Warning deleting ${table}.${col}:`, error.message)
      }
    }

    // 4. Delete profile row
    await supabaseAdmin.from('profiles').delete().eq('id', uid)

    // 5. Delete the auth user — only possible with service_role
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(uid)
    if (deleteAuthError) {
      console.error('Auth delete failed:', deleteAuthError)
      return NextResponse.json({ error: 'Failed to delete auth user: ' + deleteAuthError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('delete-account error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
