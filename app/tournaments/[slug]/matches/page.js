'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// Handles someone landing on the bare /matches path with no specific
// matchup segment (e.g. typed by hand, or an old/partial link) — just
// sends them into the Matches tab of the tournament itself.
export default function MatchesTabRedirectPage() {
  const { slug } = useParams()
  const router = useRouter()

  useEffect(() => {
    if (slug) router.replace(`/tournaments/${slug}#matches`)
  }, [slug, router])

  return null
}
