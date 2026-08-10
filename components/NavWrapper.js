'use client'
import { usePathname } from 'next/navigation'
import Nav from './Nav'
import BottomNav from './BottomNav'

// Routes where both top and bottom nav are hidden
const HIDDEN_NAV_ROUTES = [
  '/login',
  '/signup',
  '/register',
  '/forgot-password',
  '/tournaments/create',
  '/help-desk',
]

// Patterns where both navs are hidden
const HIDDEN_NAV_PATTERNS = [
  /^\/shop\/[^/]+\/request\/[^/]+/,
  /^\/games\/[^/]+\/chat/,
  /^\/dm\//,
]

// Patterns where only the top Nav is hidden (page has its own custom
// header) but the bottom nav stays, e.g. the shareable matchup card.
const HIDDEN_TOPNAV_PATTERNS = [
  /^\/tournaments\/[^/]+\/matches\/[^/]+/,
]

export default function NavWrapper() {
  const pathname = usePathname()

  const bothHidden =
    HIDDEN_NAV_ROUTES.some(route => pathname?.startsWith(route)) ||
    HIDDEN_NAV_PATTERNS.some(pattern => pattern.test(pathname || ''))

  if (bothHidden) return (
    <style>{`main { padding-bottom: 0 !important; }`}</style>
  )

  const topOnlyHidden = HIDDEN_TOPNAV_PATTERNS.some(pattern => pattern.test(pathname || ''))

  if (topOnlyHidden) return (
    <>
      <BottomNav />
      <style>{`main { padding-bottom: 80px; }`}</style>
    </>
  )

  return (
    <>
      <Nav />
      <BottomNav />
      <style>{`main { padding-bottom: 80px; }`}</style>
    </>
  )
}
