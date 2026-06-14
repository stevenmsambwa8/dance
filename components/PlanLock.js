'use client'
/**
 * components/PlanLock.js
 *
 * Usage:
 *   import PlanLock from '../components/PlanLock'
 *
 *   // Wrap any locked UI element:
 *   <PlanLock feature="create_tournament" profile={profile}>
 *     <button onClick={handleCreate}>Create Tournament</button>
 *   </PlanLock>
 *
 *   // Or just the lock icon inline (e.g. next to a nav item):
 *   <PlanLock feature="analytics" profile={profile} iconOnly />
 */

import { useState, useRef, useEffect } from 'react'
import { PLANS, FEATURE_PLAN, getPlanPrice, getActivePlan } from '../lib/plans'
import UpgradeModal from './UpgradeModal'

export default function PlanLock({ feature, profile, children, iconOnly = false }) {
  const requiredKey  = FEATURE_PLAN[feature]
  const currentKey   = getActivePlan(profile)

  // Plan order for comparison
  const ORDER = ['free', 'pro', 'elite', 'team']
  const currentIdx  = ORDER.indexOf(currentKey)
  const requiredIdx = ORDER.indexOf(requiredKey)
  const isLocked    = currentIdx < requiredIdx

  const [tipVisible,   setTipVisible]   = useState(false)
  const [modalOpen,    setModalOpen]     = useState(false)
  const tipRef = useRef(null)

  // Close tooltip on outside click
  useEffect(() => {
    if (!tipVisible) return
    const handler = (e) => { if (tipRef.current && !tipRef.current.contains(e.target)) setTipVisible(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [tipVisible])

  if (!isLocked) {
    // Feature is available — render children as-is
    return <>{children}</>
  }

  const requiredPlan = PLANS[requiredKey]
  const countryFlag  = profile?.country_flag || 'tanzania'
  const price        = getPlanPrice(requiredKey, countryFlag)

  // ── iconOnly mode: just the lock pip ──
  if (iconOnly) {
    return (
      <>
        <span ref={tipRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <button
            onClick={() => setModalOpen(true)}
            style={lockDotStyle}
            title={`${requiredPlan.label} feature`}
          >
            <i className="ri-lock-line" style={{ fontSize: 10 }} />
          </button>
        </span>
        {modalOpen && <UpgradeModal feature={feature} profile={profile} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  // ── Full wrapper mode: dim children + lock icon overlay ──
  return (
    <>
      <div ref={tipRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {/* Dim and disable children */}
        <div style={{ opacity: 0.4, pointerEvents: 'none', userSelect: 'none', flex: 1 }}>
          {children}
        </div>

        {/* Lock icon button */}
        <button
          onClick={() => setModalOpen(true)}
          style={lockBtnStyle(requiredPlan.color)}
          title={`Requires ${requiredPlan.label} — ${price}/mo`}
        >
          <i className="ri-lock-line" style={{ fontSize: 11 }} />
        </button>

        {/* Tooltip */}
        {tipVisible && (
          <div style={tooltipStyle}>
            <span style={{ fontWeight: 700, color: requiredPlan.color }}>{requiredPlan.badge} {requiredPlan.label}</span>
            {' '}required
            <button onClick={() => { setTipVisible(false); setModalOpen(true) }} style={tipBtnStyle(requiredPlan.color)}>
              Upgrade →
            </button>
          </div>
        )}
      </div>

      {modalOpen && <UpgradeModal feature={feature} profile={profile} onClose={() => setModalOpen(false)} />}
    </>
  )
}

// ── Styles ──
const lockBtnStyle = (color) => ({
  width: 20, height: 20, borderRadius: '50%',
  background: color + '22',
  border: `1px solid ${color}55`,
  color: color,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', flexShrink: 0,
  transition: 'all 0.15s',
})

const lockDotStyle = {
  width: 16, height: 16, borderRadius: '50%',
  background: 'var(--border-dark)',
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', verticalAlign: 'middle', marginLeft: 4,
}

const tooltipStyle = {
  position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%',
  transform: 'translateX(-50%)',
  background: 'var(--bg)', border: '1px solid var(--border-dark)',
  borderRadius: 8, padding: '8px 12px',
  fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap',
  boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
  zIndex: 9000,
  display: 'flex', alignItems: 'center', gap: 8,
}

const tipBtnStyle = (color) => ({
  background: color, color: '#fff',
  border: 'none', borderRadius: 4,
  padding: '3px 8px', fontSize: 11,
  fontWeight: 700, cursor: 'pointer',
  fontFamily: 'var(--font)',
})
