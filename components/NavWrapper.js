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

export default function NavWrapper() {
  const pathname = usePathname()

  const isHidden =
    HIDDEN_NAV_ROUTES.some(route => pathname?.startsWith(route)) ||
    HIDDEN_NAV_PATTERNS.some(pattern => pattern.test(pathname || ''))

  if (isHidden) return (
    <style>{`main { padding-bottom: 0 !important; }`}</style>
  )

  return (
    <>
      <Nav />
      <BottomNav />
      <style>{`main { padding-bottom: 72px; }`}</style>
    </>
  )
}
