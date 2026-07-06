import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SUPABASE_URL  = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Escalating 7-day cycle — day 7 is the big one, then it loops back to day 1.
export const REWARD_TIERS = [10, 15, 20, 30, 40, 55, 100]

// Dates compared as East Africa Time (UTC+3, no DST) calendar days, since
// that's fv's actual user base — comparing raw UTC would roll the day over
// at 3am local time and make "today"/"yesterday" feel wrong to players.
function eatDateString(d = new Date()) {
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000)
  return eat.toISOString().slice(0, 10)
}

async function getUserFromRequest(request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAnon.auth.getUser(token)
  return user || null
}

/**
 * GET /api/daily-reward
 * Returns current streak status without claiming anything — used to render
 * the 7-day tracker and whether today's reward is still available.
 */
export async function GET(request) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (!SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('login_streak_day, last_login_claim')
      .eq('id', user.id)
      .single()
    if (error) throw error

    const today     = eatDateString()
    const yesterday = eatDateString(new Date(Date.now() - 24 * 60 * 60 * 1000))
    const last = profile.last_login_claim
    const currentDay = profile.login_streak_day || 0

    const claimedToday = last === today
    // Streak is only "alive" (i.e. tomorrow's claim continues it) if the
    // last claim was today or yesterday. Anything older means the next
    // claim resets to day 1 — the skipped days are simply gone.
    const streakAlive = last === today || last === yesterday
    const nextDay = claimedToday ? currentDay : (streakAlive ? (currentDay % 7) + 1 : 1)

    return NextResponse.json({
      tiers: REWARD_TIERS,
      currentDay,
      claimedToday,
      canClaim: !claimedToday,
      nextDay,
      nextReward: REWARD_TIERS[nextDay - 1],
    })
  } catch (err) {
    console.error('daily-reward GET error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}

/**
 * POST /api/daily-reward
 * Claims today's reward if not already claimed. If the player missed a day
 * (last claim was before yesterday), the streak resets to day 1 — whatever
 * day they were on is forfeited, not banked for later.
 */
export async function POST(request) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (!SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })

    const { data: profile, error: findErr } = await supabaseAdmin
      .from('profiles')
      .select('points, login_streak_day, last_login_claim')
      .eq('id', user.id)
      .single()
    if (findErr) throw findErr

    const today     = eatDateString()
    const yesterday = eatDateString(new Date(Date.now() - 24 * 60 * 60 * 1000))
    const last = profile.last_login_claim
    const currentDay = profile.login_streak_day || 0

    if (last === today) {
      return NextResponse.json({
        success: false,
        alreadyClaimed: true,
        currentDay,
        nextReward: null,
      })
    }

    const streakAlive = last === yesterday
    const streakBroken = !!last && last !== yesterday && last !== today
    const claimDay = streakAlive ? (currentDay % 7) + 1 : 1
    const reward = REWARD_TIERS[claimDay - 1]

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        login_streak_day: claimDay,
        last_login_claim: today,
        points: (profile.points || 0) + reward,
      })
      .eq('id', user.id)
    if (updateErr) throw updateErr

    await supabaseAdmin.from('earnings_log').insert({
      user_id: user.id,
      type: 'daily_reward',
      points: reward,
      description: `Day ${claimDay} of 7 login streak${claimDay === 7 ? ' — cycle complete 🔥' : ''}`,
    })

    await supabaseAdmin.from('notifications').insert({
      user_id: user.id,
      title: '🎁 Daily Reward Claimed',
      body: `Day ${claimDay} of 7 — +${reward} points${claimDay === 7 ? '. Streak complete! 🔥' : ''}`,
      type: 'reward',
      meta: { day: claimDay, points: reward },
      read: false,
    })

    return NextResponse.json({
      success: true,
      alreadyClaimed: false,
      day: claimDay,
      reward,
      streakBroken,
      cycleComplete: claimDay === 7,
    })
  } catch (err) {
    console.error('daily-reward POST error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
