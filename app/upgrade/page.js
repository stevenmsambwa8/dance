'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, isHelpdeskEmail } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import UpgradeModal from '../../components/UpgradeModal'
import UserBadges from '../../components/UserBadges'
import { supabase } from '../../lib/supabase'
import { PLANS, getPlanPrice, getActivePlan, FEATURE_PLAN } from '../../lib/plans'
import useTranslation from '../../lib/useTranslation'
import styles from './page.module.css'

const ORDER = ['free', 'pro', 'elite', 'team']

// 3-stop gradients themed around each plan's accent color.
const PLAN_THEME = {
  pro:   { grad: 'linear-gradient(135deg, #d8b4fe 0%, #a855f7 48%, #6d28d9 100%)', c2: '#7c3aed', soft: 'rgba(168,85,247,0.14)' },
  elite: { grad: 'linear-gradient(135deg, #7dd3fc 0%, #38bdf8 45%, #6366f1 100%)', c2: '#4f46e5', soft: 'rgba(56,189,248,0.14)' },
  team:  { grad: 'linear-gradient(135deg, #86efac 0%, #22c55e 45%, #0891b2 100%)', c2: '#0891b2', soft: 'rgba(34,197,94,0.14)' },
}

const TRUST_ITEMS = [
  { key: 'trustInstant', desc: 'trustInstantDesc', icon: 'ri-flashlight-line', grad: 'linear-gradient(135deg, #a855f7, #ec4899)' },
  { key: 'trustSecure', desc: 'trustSecureDesc', icon: 'ri-shield-check-line', grad: 'linear-gradient(135deg, #38bdf8, #6366f1)' },
  { key: 'trustFlexible', desc: 'trustFlexibleDesc', icon: 'ri-refresh-line', grad: 'linear-gradient(135deg, #22c55e, #0891b2)' },
  { key: 'trustSupport', desc: 'trustSupportDesc', icon: 'ri-customer-service-2-line', grad: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
]

const FAQS = [
  { q: 'faqQ1', a: 'faqA1' },
  { q: 'faqQ2', a: 'faqA2' },
  { q: 'faqQ3', a: 'faqA3' },
  { q: 'faqQ4', a: 'faqA4' },
]

const FOLLOW_SAMPLE_SIZE = 8

/* ── Suggested follows: pulls everyday users, same data model as /players ── */
function SuggestedFollows() {
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()
  const { t } = useTranslation()
  const [people, setPeople] = useState(null) // null = loading
  const [following, setFollowing] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Pull a wider pool of regular profiles, then sample a handful client-side
      // so the row feels like "everyday users" rather than just the top ranks.
      const { data } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, tier, level, plan, plan_expires_at, country_flag, is_season_winner, email')
        .order('created_at', { ascending: false })
        .limit(40)
      if (cancelled) return
      const pool = (data || []).filter(p => p.id !== user?.id && !isHelpdeskEmail(p.email))
      const shuffled = [...pool].sort(() => Math.random() - 0.5)
      setPeople(shuffled.slice(0, FOLLOW_SAMPLE_SIZE))
    }
    load()
    return () => { cancelled = true }
  }, [user?.id])

  useEffect(() => {
    if (!user || !people?.length) return
    supabase.from('follows').select('following_id').eq('follower_id', user.id)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(f => { map[f.following_id] = true })
        setFollowing(map)
      })
  }, [user, people])

  async function toggleFollow(e, personId) {
    e.stopPropagation()
    if (!user) { openAuthGate(); return }
    const isF = following[personId]
    setFollowing(f => ({ ...f, [personId]: !isF }))
    if (isF) {
      await supabase.from('follows').delete()
        .eq('follower_id', user.id).eq('following_id', personId)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: personId })
    }
  }

  if (people && people.length === 0) return null

  return (
    <div className={styles.section}>
      <p className={styles.sectionTitle}>{t('upgradePage.suggestedFollowsTitle')}</p>
      <p className={styles.subtitle} style={{ margin: '-6px 0 12px', textAlign: 'left' }}>
        {t('upgradePage.suggestedFollowsSub')}
      </p>
      <div className={styles.followScroll}>
        {people === null
          ? [...Array(4)].map((_, i) => <div key={i} className={styles.followSkeleton} />)
          : people.map(p => {
              const isF = !!following[p.id]
              return (
                <div key={p.id} className={styles.followCard} onClick={() => router.push(`/profile/${p.id}`)}>
                  <div className={styles.followAvatar}>
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" />
                      : <span>{(p.username || '?').slice(0, 2).toUpperCase()}</span>}
                  </div>
                  <p className={styles.followName}>
                    {(p.username || '?').length > 10 ? (p.username || '?').slice(0, 10) + '…' : (p.username || '?')}
                    <UserBadges
                      email={p.email} plan={p.plan} planExpiresAt={p.plan_expires_at}
                      countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner}
                      size={10} gap={2} />
                  </p>
                  <p className={styles.followMeta}>{p.tier || 'Bronze'} · Lv.{p.level ?? 1}</p>
                  <button
                    className={[styles.followBtn, isF ? styles.followBtnActive : ''].join(' ')}
                    onClick={e => toggleFollow(e, p.id)}
                  >
                    <i className={isF ? 'ri-check-line' : 'ri-user-add-line'} />
                    {isF ? t('upgradePage.following') : t('upgradePage.follow')}
                  </button>
                </div>
              )
            })}
      </div>
    </div>
  )
}

export default function UpgradePage() {
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const { t } = useTranslation()
  const [modal, setModal] = useState(null) // plan key
  const [openFaq, setOpenFaq] = useState(0)

  const currentPlan = getActivePlan(profile)
  const countryFlag = profile?.country_flag || 'tanzania'

  const plans = Object.values(PLANS).filter(p => p.key !== 'free')

  return (
    <div className={styles.page}>
      <div className={styles.inner}>

        {/* Header */}
        <div className={styles.header}>
          <span className={styles.eyebrow}>
            <i className="ri-rocket-2-line" /> NABOGAMING
          </span>
          <p className={styles.title}>{t('upgradePage.levelUpYourGame')}</p>
          <p className={styles.subtitle}>{t('upgradePage.unlockFullExperience')}</p>
          {currentPlan !== 'free' && (
            <div>
              <span className={styles.currentPlanPill}>
                <i className={PLANS[currentPlan]?.icon} style={{ color: PLANS[currentPlan]?.color }} />
                {t('upgradePage.currentPlanPrefix')} {PLANS[currentPlan]?.label}
              </span>
            </div>
          )}
        </div>

        {/* Swipe hint */}
        <p className={styles.swipeHint}>
          <i className="ri-arrow-left-s-line" />
          {t('upgradePage.swipeHint')}
          <i className="ri-arrow-right-s-line" />
        </p>

        {/* Scrollable plan cards */}
        <div className={styles.scrollerWrap}>
          <div className={styles.scroller}>
            {plans.map(plan => {
              const idx        = ORDER.indexOf(plan.key)
              const currentIdx = ORDER.indexOf(currentPlan)
              const isActive   = currentPlan === plan.key
              const isLower    = idx <= currentIdx && !isActive
              const price      = getPlanPrice(plan.key, countryFlag)
              const theme      = PLAN_THEME[plan.key] || PLAN_THEME.pro

              const cardStyle = {
                '--plan-grad': theme.grad,
                '--plan-c1-soft': theme.soft,
                '--plan-c2': theme.c2,
              }

              return (
                <div
                  key={plan.key}
                  className={[styles.card, isLower ? styles.cardLower : ''].join(' ')}
                  style={cardStyle}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.cardBlobA} />
                    <div className={styles.cardBlobB} />

                    {plan.popular && !isActive && (
                      <span className={styles.ribbon}>{t('upgradePage.mostPopular')}</span>
                    )}
                    {isActive && (
                      <span className={styles.ribbon}>{t('upgradePage.yourPlan')}</span>
                    )}

                    <div className={styles.iconChip}>
                      <i className={plan.icon} />
                    </div>
                    <p className={styles.planLabel}>{plan.label}</p>
                    <div className={styles.planPriceRow}>
                      <span className={styles.planPrice}>{price}</span>
                      <span className={styles.planPer}>{t('upgradePage.perMonth')}</span>
                    </div>
                  </div>

                  <div className={styles.cardBody}>
                    <div className={styles.featureList}>
                      {plan.features.map((f, i) => (
                        <div key={i} className={styles.featureRow}>
                          <span className={styles.featureCheck}>
                            <i className="ri-check-line" />
                          </span>
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>

                    {isActive ? (
                      <div className={[styles.cta, styles.ctaActive].join(' ')} style={{ background: theme.soft }}>
                        <i className="ri-check-circle-line" /> {t('upgradePage.activePlan')}
                      </div>
                    ) : isLower ? (
                      <div className={[styles.cta, styles.ctaLower].join(' ')}>
                        {t('upgradePage.alreadyUnlocked')}
                      </div>
                    ) : (
                      <button className={styles.cta} onClick={() => user ? setModal(plan.key) : openAuthGate()}>
                        {t('upgradePage.getPlan')} {plan.label} <i className="ri-arrow-right-line" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Suggested people to follow */}
        <SuggestedFollows />

        {/* Why upgrade / trust badges */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>{t('upgradePage.whyUpgradeTitle')}</p>
          <div className={styles.trustGrid}>
            {TRUST_ITEMS.map(item => (
              <div key={item.key} className={styles.trustCard}>
                <div className={styles.trustIcon} style={{ background: item.grad }}>
                  <i className={item.icon} />
                </div>
                <p className={styles.trustTitle}>{t(`upgradePage.${item.key}`)}</p>
                <p className={styles.trustDesc}>{t(`upgradePage.${item.desc}`)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Payment methods */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>{t('upgradePage.paymentMethodsTitle')}</p>
          <div className={styles.payRow}>
            <div className={styles.payChip}>
              <i className="ri-smartphone-line" />
              <span>M-Pesa</span>
            </div>
            <div className={styles.payChip}>
              <i className="ri-smartphone-line" />
              <span>Halopesa</span>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>{t('upgradePage.faqTitle')}</p>
          <div className={styles.faqList}>
            {FAQS.map((faq, i) => {
              const isOpen = openFaq === i
              return (
                <div key={faq.q} className={styles.faqItem}>
                  <button
                    className={[styles.faqQ, isOpen ? styles.faqQOpen : ''].join(' ')}
                    onClick={() => setOpenFaq(isOpen ? -1 : i)}
                  >
                    <span>{t(`upgradePage.${faq.q}`)}</span>
                    <i className="ri-arrow-down-s-line" />
                  </button>
                  {isOpen && <p className={styles.faqA}>{t(`upgradePage.${faq.a}`)}</p>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer note */}
        <p className={styles.footerNote}>{t('upgradePage.footerNote')}</p>
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
