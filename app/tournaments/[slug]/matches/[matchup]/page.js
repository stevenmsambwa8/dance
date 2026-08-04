'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { matchupSlugMatches } from '../../../../../lib/matchSlug'
import { knockoutKey, fixtureKey } from '../../../../../lib/matchScheduler'

// This route exists purely to give pending-result nudges a readable URL
// like /tournaments/summer-clash/matches/abi-vs-seti. It looks up which
// actual match that refers to, then hands off to the real tournament page
// using the same #ko-<r>-<p> / #fx-<id> hash deep link the Matches/Groups
// tabs already know how to open, scroll to, and highlight.
export default function MatchupResolverPage() {
  const { slug, matchup } = useParams()
  const router = useRouter()
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
      const { data: t } = await (isUUID
        ? supabase.from('tournaments').select('*').eq('id', slug).single()
        : supabase.from('tournaments').select('*').eq('slug', slug).single()
      )
      if (cancelled) return
      if (!t) { setNotFound(true); return }

      const tournamentPath = `/tournaments/${t.slug || slug}`
      let bd = t.bracket_data
      try { bd = typeof bd === 'string' ? JSON.parse(bd) : bd } catch { bd = null }
      if (!bd) { router.replace(tournamentPath); return }

      // ── Search group/league fixtures ──
      for (const group of bd.groups || []) {
        for (const fx of group.fixtures || []) {
          const home = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.homeId)
          const away = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.awayId)
          if (matchupSlugMatches(matchup, home?.name, away?.name)) {
            router.replace(`${tournamentPath}#${fixtureKey(fx.id).replace(':', '-')}`)
            return
          }
        }
      }

      // ── Search knockout pairs ──
      for (let rIdx = 0; rIdx < (bd.rounds?.length || 0); rIdx++) {
        const pairs = bd.rounds[rIdx] || []
        for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
          const [a, b] = pairs[pIdx] || []
          if (!a || !b) continue
          const nameA = a.name || a.teamName
          const nameB = b.name || b.teamName
          if (matchupSlugMatches(matchup, nameA, nameB)) {
            router.replace(`${tournamentPath}#${knockoutKey(rIdx, pIdx).replace(':', '-')}`)
            return
          }
        }
      }

      // Not found (score already changed hands, name changed, etc.) — just
      // send them to the tournament so they can find it themselves.
      router.replace(tournamentPath)
    }

    if (slug && matchup) resolve()
    return () => { cancelled = true }
  }, [slug, matchup, router])

  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
      {!notFound ? (
        <>
          <i className="ri-loader-4-line" style={{ fontSize: 28, animation: 'spin 0.8s linear infinite', color: 'var(--text-muted, #9ca3af)' }} />
          <div style={{ fontSize: 13, color: 'var(--text-muted, #9ca3af)', fontWeight: 600 }}>Finding your match…</div>
        </>
      ) : (
        <>
          <i className="ri-error-warning-line" style={{ fontSize: 28, color: '#ef4444' }} />
          <div style={{ fontSize: 13, fontWeight: 700 }}>Tournament not found</div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
