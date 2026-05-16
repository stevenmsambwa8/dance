'use client'
/**
 * usePageLoading — now a no-op.
 * Page transitions use slide animation (PageTransition.js) instead of
 * a loading overlay. This hook is kept so existing page imports don't break.
 */
export default function usePageLoading(_isLoading) {
  // No-op — slide transition handles the UX
}
