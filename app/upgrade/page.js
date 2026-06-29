'use client'
import { useState } from 'react'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import UpgradeModal from '../../components/UpgradeModal'
import { PLANS, getPlanPrice, getActivePlan, FEATURE_PLAN } from '../../lib/plans'
import styles from './page.module.css'
import { DiamondBadge, ProBadge } from '../../components/UserBadges'

const ORDER = ['free', 'pro', 'elite', 'team']

export default function UpgradePage() {
  const { user, profile } = useAuth()
  const { openAuthGate }  = useAuthGate()
  const [modal, setModal] = useState(null) // plan key

  const currentPlan = getActivePlan(profile)
  const countryFlag = profile?.country_flag || 'tanzania'

  const plans = Object.values(PLANS).filter(p => p.key !== 'free')

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', padding: '32px 16px 80px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)', margin: '0 0 8px', lineHeight: 1.1 }}>Level Up Your Game</p>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>Unlock the full Nabogaming experience</p>
          {currentPlan !== 'free' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '5px 12px', background: 'var(--surface)', border: '1px solid var(--border-dark)', borderRadius: 20, fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              <i className={PLANS[currentPlan]?.icon} style={{ color: PLANS[currentPlan]?.color }} />
              Current plan: {PLANS[currentPlan]?.label}
            </span>
          )}
        </div>

        {/* Plan cards */}
        {plans.map(plan => {
          const idx        = ORDER.indexOf(plan.key)
          const currentIdx = ORDER.indexOf(currentPlan)
          const isActive   = currentPlan === plan.key
          const isLower    = idx <= currentIdx && !isActive
          const price      = getPlanPrice(plan.key, countryFlag)

          return (
            <div key={plan.key} style={{
              border: isActive ? `2px solid ${plan.color}` : plan.popular ? `2px solid ${plan.color}55` : '2px solid var(--border)',
              borderRadius: 16, padding: '20px 18px', position: 'relative',
              background: isActive ? plan.color + '0d' : 'var(--bg-2)',
              opacity: isLower ? 0.5 : 1,
            }}>
              {plan.popular && !isActive && (
                <span style={{ position: 'absolute', top: -1, right: 16, background: plan.color, color: '#fff', fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: '0 0 7px 7px', letterSpacing: '0.06em' }}>MOST POPULAR</span>
              )}
              {isActive && (
                <span style={{ position: 'absolute', top: -1, right: 16, background: plan.color, color: '#fff', fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: '0 0 7px 7px', letterSpacing: '0.06em' }}>YOUR PLAN</span>
              )}

              {/* Plan header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: plan.color + '20', border: `1.5px solid ${plan.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                    {(plan.key === 'elite' || plan.key === 'team') ? <DiamondBadge size={26} /> : plan.key === 'pro' ? <ProBadge size={26} /> : <span style={{ fontSize: 22 }}>{plan.badge}</span>}
                  </div>
                  <div>
                    <p style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', margin: 0 }}>{plan.label}</p>
                    <p style={{ fontSize: 13, color: plan.color, fontWeight: 700, margin: '2px 0 0' }}>{price}<span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}> / month</span></p>
                  </div>
                </div>
                <i className={plan.icon} style={{ fontSize: 22, color: plan.color + '80' }} />
              </div>

              {/* Features */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
                {plan.features.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-dim)' }}>
                    <i className="ri-check-line" style={{ color: plan.color, fontSize: 14, flexShrink: 0, marginTop: 1 }} />
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              {isActive ? (
                <div style={{ padding: '10px 16px', borderRadius: 8, background: plan.color + '20', textAlign: 'center', fontSize: 13, fontWeight: 700, color: plan.color }}>
                  <i className="ri-check-circle-line" /> Active Plan
                </div>
              ) : isLower ? (
                <div style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--border)', textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Already unlocked
                </div>
              ) : (
                <button
                  onClick={() => user ? setModal(plan.key) : openAuthGate()}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 8, background: plan.color, color: '#fff', border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'opacity 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  Get {plan.label} <i className="ri-arrow-right-line" />
                </button>
              )}
            </div>
          )
        })}

        {/* Footer note */}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.7 }}>
          Payment via M-Pesa or Halopesa. Plans activate within 24 hours after admin verification. Cancel anytime by not renewing.
        </p>
      </div>

      {modal && (
        <UpgradeModal
          feature={Object.keys(FEATURE_PLAN).find(f => FEATURE_PLAN[f] === modal) || 'create_tournament'}
          profile={profile}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
