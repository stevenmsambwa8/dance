import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SUPABASE_URL  = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Keep this in sync with components/AuthProvider.js's ADMIN_EMAILS — this
// route can't import that file (it's a 'use client' provider), so the list
// is mirrored here.
const ADMIN_EMAILS = ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com']

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Only these columns can be written through this route — an allowlist so
// the admin dashboard can never smuggle through something like `id` or
// `email` via the same payload shape.
const EDITABLE_FIELDS = [
  'username', 'tier', 'level', 'wins', 'losses', 'points', 'bio', 'phone',
  'country_flag', 'is_season_winner', 'custom_badges',
]

async function getRequestingAdmin(request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAnon.auth.getUser(token)
  if (!user || !ADMIN_EMAILS.includes(user.email)) return null
  return user
}

/**
 * POST /api/admin/update-profile
 * Body: { userId, updates: { username, tier, ... } }
 *
 * The dashboard's edit-user page used to call supabase.from('profiles')
 * .update() directly from the browser using the admin's own session — but
 * the profiles table's update RLS policy only allows a row's owner to
 * update it, so that was silently blocked by RLS for every field whenever
 * an admin edited someone else's profile (not the 60-day username/avatar/
 * flag cooldown, which already exempts admins — see
 * lib/profile-lock-schema.sql).
 *
 * This route runs server-side with the service role key, which bypasses
 * RLS entirely, after confirming the caller is a logged-in admin.
 */
export async function POST(request) {
  try {
    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const admin = await getRequestingAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { userId, updates } = body || {}
    if (!userId || !updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Missing userId or updates' }, { status: 400 })
    }

    const payload = {}
    for (const key of EDITABLE_FIELDS) {
      if (key in updates) payload[key] = updates[key]
    }
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'No editable fields in updates' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, profile: data })
  } catch (err) {
    console.error('admin update-profile error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
