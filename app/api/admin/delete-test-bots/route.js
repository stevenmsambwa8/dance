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
      .select('id, username')
      .eq('is_bot', true)

    if (findErr) throw findErr

    const deleted = []
    const errors = []

    for (const bot of bots || []) {
      await supabaseAdmin.from('tournament_participants').delete().eq('user_id', bot.id)

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
      errors,
    })
  } catch (err) {
    console.error('delete-test-bots error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
