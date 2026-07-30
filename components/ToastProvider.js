'use client'
import { createContext, useContext } from 'react'

/* ─────────────────────────────────────────────────────────────────
   Pop-up toast notifications have been removed (Jul 2026). The bell
   icon + dropdown + unread badge in Nav.js already handles surfacing
   notifications and is fully independent of this file — this is now
   just a harmless pass-through kept so existing imports don't break.
   ──────────────────────────────────────────────────────────────── */
const ToastContext = createContext(null)
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }) {
  return (
    <ToastContext.Provider value={{ addToast: () => {} }}>
      {children}
    </ToastContext.Provider>
  )
}
