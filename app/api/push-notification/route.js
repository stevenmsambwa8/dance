// app/api/push-notification/route.js

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const ONESIGNAL_APP_ID     = process.env.ONESIGNAL_APP_ID
const ONESIGNAL_API_KEY    = process.env.ONESIGNAL_REST_API_KEY
const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL              = process.env.NEXT_PUBLIC_APP_URL || 'https://www.nabogaming.live'

const ICON_URL  = `${APP_URL}/logo-transparent.png`
const BADGE_URL = `${APP_URL}/logo-badge.png`

const PUSH_TYPES = new Set([
  'direct_message',
  'group_chat',
  'tournament',
  'buy_request',
  'request_update',
  'negotiation_message',
  'match_request_accepted',
])

export async function POST(req) {
  try {
    const body = await req.json()

    const record = body.record
    if (!record) return NextResponse.json({ ok: false, reason: 'no record' })

    const { user_id, type, title, body: notifBody, meta } = record

    if (!PUSH_TYPES.has(type)) {
      return NextResponse.json({ ok: false, reason: 'skipped type' })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: profile } = await supabase
      .from('profiles')
      .select('onesignal_player_id')
      .eq('id', user_id)
      .single()

    if (!profile?.onesignal_player_id) {
      return NextResponse.json({ ok: false, reason: 'no player id' })
    }

    const url = getDeepLink(type, meta)

    const pushPayload = {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: [profile.onesignal_player_id],
      headings: { en: title },
      contents: { en: notifBody },
      // Your logo (transparent bg)
      chrome_web_icon: ICON_URL,
      chrome_web_badge: BADGE_URL,
      // Collapse duplicate notifications of the same thread/chat
      collapse_id: getCollapseId(type, meta),
      // Deep link — tapping opens the right page
      ...(url ? { url } : {}),
      // Extra data for in-app handling
      data: { type, ...(meta || {}) },
    }

    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(pushPayload),
    })

    const result = await res.json()
    if (!res.ok) {
      console.error('[push] OneSignal error:', result)
      return NextResponse.json({ ok: false, error: result }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: result.id })

  } catch (err) {
    console.error('[push] unhandled error:', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

function getDeepLink(type, meta) {
  switch (type) {
    case 'direct_message':
      return meta?.sender_id ? `${APP_URL}/dm/${meta.sender_id}` : `${APP_URL}/dm`
    case 'group_chat':
      return meta?.game_slug ? `${APP_URL}/games/${meta.game_slug}/chat` : `${APP_URL}/games`
    case 'tournament':
      return meta?.tournament_id ? `${APP_URL}/tournaments/${meta.tournament_id}` : `${APP_URL}/tournaments`
    case 'buy_request':
    case 'request_update':
    case 'negotiation_message':
      return meta?.item_id && meta?.request_id
        ? `${APP_URL}/shop/${meta.item_id}/request/${meta.request_id}`
        : `${APP_URL}/my-requests`
    case 'match_request_accepted':
      return meta?.match_id ? `${APP_URL}/matches/${meta.match_id}` : `${APP_URL}/matches`
    default:
      return `${APP_URL}/notifications`
  }
}

function getCollapseId(type, meta) {
  if (type === 'direct_message' && meta?.sender_id)        return `dm-${meta.sender_id}`
  if (type === 'group_chat' && meta?.game_slug)             return `gchat-${meta.game_slug}`
  if (type === 'negotiation_message' && meta?.request_id)  return `req-${meta.request_id}`
  return type
}
