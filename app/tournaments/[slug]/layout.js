import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://whnsrbxeqorolkjfcniy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0'
)

const GAME_META = {
  pubg:         { name: 'PUBGM' },
  freefire:     { name: 'Free Fire' },
  codm:         { name: 'Call of Duty Mobile' },
  maleo_bussid: { name: 'Maleo BUSSID' },
  efootball:    { name: 'eFootball' },
  dls:          { name: 'DLS26' },
  ufl:          { name: 'UFL' },
}

const BASE_URL = 'https://nabogaming.live'

export async function generateMetadata({ params }) {
  const { slug } = await params

  const isUUID = /^[0-9a-f-]{36}$/i.test(slug)
  const { data: t } = isUUID
    ? await supabase.from('tournaments').select('id,name,game_slug,prize,slug').eq('id', slug).single()
    : await supabase.from('tournaments').select('id,name,game_slug,prize,slug').eq('slug', slug).single()

  if (!t) {
    return {
      title: 'Tournament — Nabogaming',
      description: 'Compete. Rank. Dominate.',
    }
  }

  const gameName = GAME_META[t.game_slug]?.name || t.game_slug || 'Gaming'
  const prize    = t.prize ? Number(String(t.prize).replace(/[^0-9.]/g, '')) : null
  const hasPrize = prize && !isNaN(prize) && prize > 0

  const title       = `${t.name} — Nabogaming`
  const description = [
    gameName,
    hasPrize ? `TZS ${prize.toLocaleString()} prize pool` : null,
    'Tournament bracket on Nabogaming',
  ].filter(Boolean).join(' · ')

  const ogImageUrl = `${BASE_URL}/api/og/tournament?id=${t.id}`
  const pageUrl    = `${BASE_URL}/tournaments/${t.slug || t.id}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Nabogaming',
      images: [
        {
          url: ogImageUrl,
          width: 900,
          height: 600,
          alt: t.name,
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
      site: '@nabogaming',
    },
  }
}

export default function TournamentLayout({ children }) {
  return children
}