import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Pull URL directly, same as other API routes in this app
const SUPABASE_URL = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Must match the tournament page's own countdown window (app/tournaments/[slug]/page.js)
const TEST_WINDOW_MS = 3 * 60 * 60 * 1000

// Baseline stats a bot profile is reset to on every cleanup run. This is what
// actually "terminates" a test account's effect — wins/points/level a bot
// picked up from test-run matches get wiped out here, so bots can never
// accumulate enough stats to look like a real player on the public
// leaderboard or in search, no matter how many test tournaments run.
const BOT_BASELINE = {
  wins: 0, losses: 0, points: 0, level: 1,
  season_wins: 0, season_losses: 0,
}

/**
 * GET /api/cron/cleanup-test-tournaments
 *
 * Runs on a schedule (see vercel.json) instead of relying on someone having
 * the tournament page open — the old client-side setTimeout in
 * app/tournaments/[slug]/page.js only fires if a browser tab is sitting on
 * that exact page when the 3-hour window lapses, so a test tournament nobody
 * revisits just sits there indefinitely with its bot participants intact.
 *
 * This route:
 *  1. Finds every is_test tournament older than TEST_WINDOW_MS
 *  2. Deletes it and all related rows (leaderboard, participants, payments)
 *  3. Resets every bot profile's stats back to baseline, so no leftover
 *     test-run wins/points/level ever leak into the public leaderboard
 */
export async function GET(request) {
  try {
    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    // Vercel Cron sends this header automatically when CRON_SECRET is set as
    // an env var — protects the route from being triggered by randoms.
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const cutoff = new Date(Date.now() - TEST_WINDOW_MS).toISOString()

    const { data: expired, error: findErr } = await supabaseAdmin
      .from('tournaments')
      .select('id, name')
      .eq('is_test', true)
      .lt('created_at', cutoff)

    if (findErr) throw findErr

    let deletedTournaments = 0
    for (const t of expired || []) {
      await supabaseAdmin.from('tournament_leaderboard').delete().eq('tournament_id', t.id)
      await supabaseAdmin.from('tournament_participants').delete().eq('tournament_id', t.id)
      await supabaseAdmin.from('tournament_payments').delete().eq('tournament_id', t.id)
      const { error: delErr } = await supabaseAdmin.from('tournaments').delete().eq('id', t.id)
      if (!delErr) deletedTournaments++
    }

    // Reset bot profiles every run — cheap and guarantees no drift even if a
    // bot picked up stats from a test tournament that hasn't expired yet.
    const { data: bots, error: botsErr } = await supabaseAdmin
      .from('profiles')
      .update(BOT_BASELINE)
      .eq('is_bot', true)
      .select('id')

    if (botsErr) throw botsErr

    return NextResponse.json({
      success: true,
      deletedTournaments,
      expiredNames: (expired || []).map(t => t.name),
      botsReset: bots?.length || 0,
      ranAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('cleanup-test-tournaments error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
