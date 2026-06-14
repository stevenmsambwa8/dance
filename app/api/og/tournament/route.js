import { ImageResponse } from 'next/og'

export const runtime = 'edge'

const SUPABASE_URL  = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0'
const BASE          = 'https://nabogaming.live'

const GAME_META = {
  pubg:         { name: 'PUBG Mobile',   color: '#f97316', img: `${BASE}/games/pubg.png`       },
  freefire:     { name: 'Free Fire',     color: '#ef4444', img: `${BASE}/games/freefire.png`   },
  codm:         { name: 'Call of Duty',  color: '#94a3b8', img: `${BASE}/games/callofduty.png` },
  maleo_bussid: { name: 'Maleo BUSSID', color: '#22c55e', img: `${BASE}/games/maleo.png`      },
  efootball:    { name: 'eFootball',     color: '#3b82f6', img: `${BASE}/games/efootball.png`  },
  dls:          { name: 'DLS26',         color: '#8b5cf6', img: `${BASE}/games/dls.png`        },
  ufl:          { name: 'UFL',           color: '#06b6d4', img: `${BASE}/games/ufl.png`        },
}

async function sbFetch(table, filters) {
  const params = new URLSearchParams({ select: '*', ...filters, limit: 1 })
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
  })
  const data = await res.json()
  return Array.isArray(data) ? data[0] : null
}

async function sbCount(table, eq) {
  const params = new URLSearchParams({ select: 'user_id', ...eq })
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      Prefer: 'count=exact',
    },
  })
  const range = res.headers.get('content-range')
  return range ? parseInt(range.split('/')[1]) || 0 : 0
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return new Response('Missing id', { status: 400 })

  const isUUID = /^[0-9a-f-]{36}$/i.test(id)
  const filter = isUUID ? { id: `eq.${id}` } : { slug: `eq.${id}` }

  const t = await sbFetch('tournaments', filter)
  if (!t) return new Response('Not found', { status: 404 })
  const count = await sbCount('tournament_participants', { tournament_id: `eq.${t.id}` })

  const game     = GAME_META[t.game_slug] || { name: t.game_slug || 'Gaming', color: '#f59e0b', img: null }
  const prize    = t.prize ? Number(String(t.prize).replace(/[^0-9.]/g, '')) : null
  const hasPrize = prize && !isNaN(prize) && prize > 0
  const status   = t.status === 'completed' ? 'COMPLETED' : t.status === 'active' ? 'LIVE NOW' : 'UPCOMING'
  const statusColor = t.status === 'active' ? '#22c55e' : t.status === 'completed' ? '#f59e0b' : '#64748b'

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200, height: 630,
          display: 'flex',
          background: '#07070f',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Game art right side */}
        {game.img && (
          <img
            src={game.img}
            width={580} height={630}
            style={{
              position: 'absolute', right: 0, top: 0,
              objectFit: 'cover', objectPosition: 'center top',
            }}
          />
        )}

        {/* Fade overlay left→right */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          background: 'linear-gradient(to right, #07070f 44%, rgba(7,7,15,0.85) 62%, rgba(7,7,15,0.2) 100%)',
        }} />

        {/* Purple left glow */}
        <div style={{
          position: 'absolute', left: 0, top: 0, width: 400, height: 630, display: 'flex',
          background: 'linear-gradient(to right, rgba(124,58,237,0.22), transparent)',
        }} />

        {/* Top bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4, display: 'flex',
          background: `linear-gradient(to right, transparent, ${game.color}, #f59e0b, transparent)`,
        }} />

        {/* Content */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          padding: '48px 56px', width: 700,
          position: 'relative', zIndex: 2,
        }}>
          {/* Logo + brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
            <img
              src={`${BASE}/logo.png`}
              width={46} height={46}
              style={{ borderRadius: '50%', border: `2px solid ${game.color}` }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.15em', display: 'flex' }}>
              NABOGAMING
            </span>
          </div>

          {/* Badges */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <div style={{
              display: 'flex', padding: '5px 14px', borderRadius: 99,
              background: `${statusColor}22`, border: `1px solid ${statusColor}55`,
              fontSize: 11, fontWeight: 800, color: statusColor, letterSpacing: '0.15em',
            }}>
              {status}
            </div>
            <div style={{
              display: 'flex', padding: '5px 14px', borderRadius: 99,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.1em',
            }}>
              TOURNAMENT
            </div>
          </div>

          {/* Name */}
          <div style={{
            fontSize: 56, fontWeight: 900, color: '#f8fafc',
            lineHeight: 1.05, marginBottom: 16, display: 'flex',
          }}>
            {t.name}
          </div>

          {/* Game */}
          <div style={{
            fontSize: 22, fontWeight: 700, color: game.color,
            marginBottom: 30, display: 'flex',
          }}>
            {game.name}
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 36, marginBottom: 36 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.15em', display: 'flex' }}>PLAYERS</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', display: 'flex' }}>{count}</div>
            </div>
            {hasPrize && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.15em', display: 'flex' }}>PRIZE POOL</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#f59e0b', display: 'flex' }}>TZS {prize.toLocaleString()}</div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: 24, display: 'flex' }} />

          {/* Footer text */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, color: '#334155', display: 'flex' }}>nabogaming.live</span>
            <span style={{ fontSize: 14, color: '#334155', display: 'flex' }}>Compete · Rank · Dominate</span>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, display: 'flex',
          background: 'linear-gradient(to right, transparent, #7c3aed, #f59e0b, transparent)',
        }} />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    }
  )
}
