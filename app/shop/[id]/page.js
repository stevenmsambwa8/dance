'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import styles from './page.module.css'
import UserBadges from '../../../components/UserBadges'
import usePageLoading from '../../../components/usePageLoading'
import { useCurrency } from '../../../lib/useCurrency'

export default function ShopItemDetail() {
  const { id }   = useParams()
  const router   = useRouter()
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const { fmtAmt } = useCurrency(profile?.country_flag ?? null)

  const [item,    setItem]    = useState(null)
  const [images,  setImages]  = useState([])
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)

  // Gallery
  const [activeIdx,   setActiveIdx]   = useState(0)
  const [zoom,        setZoom]        = useState(false)
  const [zoomScale,   setZoomScale]   = useState(1)
  const [zoomOrigin,  setZoomOrigin]  = useState({ x: 50, y: 50 })
  const [lightbox,    setLightbox]    = useState(false)
  const [lbIdx,       setLbIdx]       = useState(0)
  const [imgDims,     setImgDims]     = useState({})
  const stripRef = useRef(null)

  // Buyer state
  const [myRequest,      setMyRequest]      = useState(null)
  const [requestChecked, setRequestChecked] = useState(false)
  const [buying,         setBuying]         = useState(false)

  // Seller inbox
  const [allRequests, setAllRequests] = useState([])
  const [updating,    setUpdating]    = useState(false)

  const isSeller = item && user && user.id === item.seller_id

  // Load item + images
  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: itemData }, { data: imgData }] = await Promise.all([
        supabase
          .from('shop_items')
          .select('id, seller_id, title, price, category, description, active, created_at, profiles(username, tier, level, avatar_url, email)')
          .eq('id', id).single(),
        supabase
          .from('shop_item_images')
          .select('url, sort_order')
          .eq('item_id', id)
          .order('sort_order', { ascending: true }),
      ])
      setItem(itemData || null)
      setImages(imgData?.map(i => i.url) || [])
      setLoading(false)
    }
    load()
  }, [id])

  // Check buyer's existing request
  useEffect(() => {
    if (!item || !user || isSeller) { setRequestChecked(true); return }
    supabase
      .from('buy_requests')
      .select('id, status')
      .eq('item_id', id)
      .eq('buyer_id', user.id)
      .in('status', ['pending', 'accepted', 'payment_submitted', 'admin_approved', 'payout_pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { setMyRequest(data || null); setRequestChecked(true) })
  }, [item, user, isSeller])

  // Seller realtime inbox
  useEffect(() => {
    if (!item || !user || !isSeller) return
    loadAllRequests()
    const ch = supabase.channel(`shop-req-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'buy_requests', filter: `item_id=eq.${id}` }, loadAllRequests)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'buy_requests', filter: `item_id=eq.${id}` }, loadAllRequests)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [item, user, isSeller])

  async function loadAllRequests() {
    const { data } = await supabase
      .from('buy_requests')
      .select('id, item_id, buyer_id, seller_id, offer_price, note, status, created_at, profiles!buy_requests_buyer_id_fkey(username, tier, avatar_url, email)')
      .eq('item_id', id)
      .order('created_at', { ascending: false })
    setAllRequests(data || [])
  }

  async function updateRequestStatus(reqId, status, buyerId) {
    setUpdating(true)
    await supabase.from('buy_requests').update({ status }).eq('id', reqId)
    await supabase.from('notifications').insert({
      user_id: buyerId, type: 'request_update',
      title: status === 'accepted' ? 'Offer accepted!' : 'Offer declined',
      body: status === 'accepted'
        ? `Your offer on "${item.title}" was accepted.`
        : `Your offer on "${item.title}" was declined.`,
      meta: { request_id: reqId, item_id: id }, read: false,
    })
    await loadAllRequests()
    setUpdating(false)
  }

  async function handleBuyNow() {
    if (!user) { openAuthGate(); return }
    if (myRequest) { router.push(`/shop/${id}/request/${myRequest.id}`); return }
    setBuying(true)
    const { data: myProfile } = await supabase.from('profiles').select('username').eq('id', user.id).single()
    const senderName = myProfile?.username || user.email?.split('@')[0]
    const { data: req, error } = await supabase
      .from('buy_requests')
      .insert({
        item_id: id,
        buyer_id: user.id,
        seller_id: item.seller_id,
        offer_price: Number(String(item.price).replace(/[^0-9.]/g, '')),
        note: `Hi, I want to buy "${item.title}"`,
        status: 'pending',
      })
      .select().single()
    if (error) { setBuying(false); alert(error.message); return }
    await supabase.from('notifications').insert({
      user_id: item.seller_id, type: 'buy_request',
      title: 'New buy request',
      body: `${senderName} wants to buy "${item.title}" for TZS ${item.price}`,
      meta: { request_id: req.id, item_id: id }, read: false,
    })
    router.push(`/shop/${id}/request/${req.id}`)
  }

  // Zoom handlers
  function handleMainClick(e) {
    if (!zoom) {
      const rect = e.currentTarget.getBoundingClientRect()
      setZoomOrigin({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
      setZoomScale(2.5); setZoom(true)
    } else { setZoom(false); setZoomScale(1) }
  }
  function handleMainMove(e) {
    if (!zoom) return
    const rect = e.currentTarget.getBoundingClientRect()
    setZoomOrigin({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
  }

  // Image dimension detection
  useEffect(() => {
    const src = images[activeIdx]
    if (!src || imgDims[src]) return
    const img = new Image()
    img.onload = () => setImgDims(d => ({ ...d, [src]: { w: img.naturalWidth, h: img.naturalHeight } }))
    img.src = src
  }, [activeIdx, images])

  // Lightbox keyboard
  useEffect(() => {
    if (!lightbox) return
    const h = (e) => {
      if (e.key === 'ArrowRight') setLbIdx(i => (i + 1) % images.length)
      if (e.key === 'ArrowLeft')  setLbIdx(i => (i - 1 + images.length) % images.length)
      if (e.key === 'Escape')     setLightbox(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [lightbox, images.length])

  function scrollStripTo(idx) {
    setActiveIdx(idx); setZoom(false); setZoomScale(1)
    stripRef.current?.children[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  const statusColor = s => ({ pending: '#f59e0b', accepted: '#22c55e', declined: '#ef4444', completed: '#6366f1' }[s] || '#888')
  const fmtPrice    = p => { const n = Number(String(p || '').replace(/[^0-9.]/g, '')); return isNaN(n) || n <= 0 ? p : fmtAmt(n) }

  const activeSrc   = images[activeIdx]
  const dims        = activeSrc ? imgDims[activeSrc] : null
  const aspectRatio = dims ? `${dims.w} / ${dims.h}` : '4 / 3'

  if (loading) return null
  if (!item) return (
    <div className={styles.notFound}>
      <i className="ri-ghost-line" />
      <h2>Item not found</h2>
      <Link href="/shop">← Back to shop</Link>
    </div>
  )

  const hasActiveRequest = !!myRequest
  const ctaLabel = buying ? 'Opening…' : hasActiveRequest ? 'View Request' : 'Buy Now'
  const ctaIcon  = buying ? 'ri-loader-4-line' : hasActiveRequest ? 'ri-chat-3-line' : 'ri-shopping-bag-line'

  return (
    <div className={styles.page}>

      {/* Top bar */}
      <div className={styles.topBar}>
        <Link href="/shop" className={styles.back}>
          <i className="ri-arrow-left-line" /> Shop
        </Link>
        <button className={styles.shareBtn} onClick={() => navigator.share?.({ title: item.title, url: window.location.href }).catch(() => {})}>
          <i className="ri-share-forward-line" />
        </button>
      </div>

      {/* Gallery */}
      <div className={styles.gallery}>
        {images.length > 0 ? (
          <>
            <div
              className={`${styles.mainImg} ${zoom ? styles.mainImgZoomed : ''}`}
              style={{ aspectRatio }}
              onClick={handleMainClick}
              onMouseMove={handleMainMove}
              onMouseLeave={() => { setZoom(false); setZoomScale(1) }}
            >
              <img
                src={images[activeIdx]}
                alt={item.title}
                style={{
                  transformOrigin: zoom ? `${zoomOrigin.x}% ${zoomOrigin.y}%` : 'center',
                  transform: `scale(${zoomScale})`,
                  transition: zoom ? 'transform 0.15s ease' : 'transform 0.2s ease',
                }}
              />
              {!zoom && <span className={styles.zoomHint}><i className="ri-zoom-in-line" /></span>}
              <button className={styles.expandBtn} onClick={e => { e.stopPropagation(); setLbIdx(activeIdx); setLightbox(true) }}>
                <i className="ri-fullscreen-line" />
              </button>
              {images.length > 1 && (
                <>
                  <button className={`${styles.galleryArrow} ${styles.galleryArrowL}`} onClick={e => { e.stopPropagation(); scrollStripTo((activeIdx - 1 + images.length) % images.length) }}><i className="ri-arrow-left-s-line" /></button>
                  <button className={`${styles.galleryArrow} ${styles.galleryArrowR}`} onClick={e => { e.stopPropagation(); scrollStripTo((activeIdx + 1) % images.length) }}><i className="ri-arrow-right-s-line" /></button>
                </>
              )}
              {item.category && <span className={styles.catChip}>{item.category}</span>}
            </div>
            {images.length > 1 && (
              <div className={styles.strip} ref={stripRef}>
                {images.map((src, i) => (
                  <button key={i} className={`${styles.thumb} ${i === activeIdx ? styles.thumbActive : ''}`} onClick={() => scrollStripTo(i)}>
                    <img src={src} alt="" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className={styles.noImg}>
            <i className="ri-image-line" />
            <span>No photos</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className={styles.info}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{item.title}</h1>
          <span className={item.active ? styles.availBadge : styles.soldBadge}>
            {item.active ? 'Available' : 'Sold'}
          </span>
        </div>
        <p className={styles.bigPrice}>{fmtPrice(item.price)}</p>

        {item.description && (
          <>
            <p className={styles.blockLabel}>About this item</p>
            <p className={styles.desc}>{item.description}</p>
          </>
        )}

        <div className={styles.divider} />

        <p className={styles.blockLabel}>Seller</p>
        <Link href={`/profile/${item.seller_id}`} className={styles.sellerRow}>
          <div className={styles.sellerAvatar}>
            {item.profiles?.avatar_url
              ? <img src={item.profiles.avatar_url} alt="" />
              : <span>{(item.profiles?.username || '?')[0].toUpperCase()}</span>
            }
          </div>
          <div className={styles.sellerInfo}>
            <span className={styles.sellerName}>
              {item.profiles?.username || 'Unknown'}
              <UserBadges email={item.profiles?.email} countryFlag={item.profiles?.country_flag} isSeasonWinner={item.profiles?.is_season_winner} size={12} gap={2} />
            </span>
            {item.profiles?.tier && (
              <span className={styles.sellerMeta}>{item.profiles.tier} · Lv.{item.profiles.level ?? 1}</span>
            )}
          </div>
          <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)', marginLeft: 'auto' }} />
        </Link>
      </div>

      {/* Buy strip — flat, no nested panel */}
      <div className={styles.buyStrip}>
        <div className={styles.buyStripTop}>
          <span className={styles.buyStripPrice}>{fmtPrice(item.price)}</span>
          <span className={item.active ? styles.panelStatusAvail : styles.panelStatusSold}>
            {item.active ? '● Live' : '● Sold'}
          </span>
        </div>

        {!isSeller && user && item.active && requestChecked && (
          <>
            {hasActiveRequest && (
              <div className={styles.requestTracker}>
                <div className={styles.trackerDot} style={{ background: statusColor(myRequest.status) }} />
                <div>
                  <span className={styles.trackerLabel}>Your request</span>
                  <span className={styles.trackerStatus} style={{ color: statusColor(myRequest.status) }}>
                    {myRequest.status?.charAt(0).toUpperCase() + myRequest.status?.slice(1)}
                  </span>
                </div>
              </div>
            )}
            <button
              className={`${styles.ctaBtn} ${hasActiveRequest ? styles.ctaBtnAlt : ''}`}
              onClick={handleBuyNow}
              disabled={buying}
            >
              <i className={ctaIcon} style={buying ? { animation: 'spin .7s linear infinite' } : {}} />
              {ctaLabel}
            </button>
            {!hasActiveRequest && (
              <p className={styles.ctaHint}><i className="ri-shield-check-line" /> Seller will be notified instantly</p>
            )}
          </>
        )}
        {isSeller && <div className={styles.ownerNote}><i className="ri-store-2-line" /> This is your listing</div>}
        {!user && (
          <>
            <p className={styles.panelSub}>Log in to buy or make an offer.</p>
            <Link href="/login" className={styles.ctaBtn} style={{ textDecoration: 'none' }}>
              <i className="ri-login-box-line" /> Log In to Buy
            </Link>
          </>
        )}
      </div>

      {/* Seller inbox */}
      {isSeller && (
        <div className={styles.inboxPanel}>
          <p className={styles.inboxTitle}><i className="ri-inbox-2-line" /> Buy Requests ({allRequests.length})</p>
          {allRequests.length === 0
            ? <p className={styles.inboxEmpty}>No requests yet.</p>
            : allRequests.map(req => (
              <div key={req.id} className={styles.reqCard}>
                <div className={styles.reqTop}>
                  <div className={styles.reqAvatar}>
                    {req.profiles?.avatar_url
                      ? <img src={req.profiles.avatar_url} alt="" />
                      : <span>{(req.profiles?.username || '?')[0].toUpperCase()}</span>
                    }
                  </div>
                  <div>
                    <div className={styles.reqName}>{req.profiles?.username || 'Buyer'}</div>
                    <div className={styles.reqTier}>{req.profiles?.tier}</div>
                  </div>
                  <span className={styles.reqPrice}>{fmtAmt(req.offer_price)}</span>
                </div>
                {req.note && <p className={styles.reqNote}>{req.note}</p>}
                <span className={styles.reqStatus} style={{ background: statusColor(req.status) + '20', color: statusColor(req.status) }}>
                  {req.status?.replace(/_/g, ' ')}
                </span>
                <div className={styles.reqActions}>
                  {req.status === 'pending' && (
                    <>
                      <button className={styles.reqAccept} onClick={() => updateRequestStatus(req.id, 'accepted', req.buyer_id)} disabled={updating}>
                        <i className="ri-check-line" /> Accept
                      </button>
                      <button className={styles.reqDecline} onClick={() => updateRequestStatus(req.id, 'declined', req.buyer_id)} disabled={updating}>
                        <i className="ri-close-line" /> Decline
                      </button>
                    </>
                  )}
                  <Link href={`/shop/${id}/request/${req.id}`} className={styles.reqChat}>
                    <i className="ri-chat-3-line" /> Chat
                  </Link>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(false)}>
          <button className={styles.lightboxClose}><i className="ri-close-line" /></button>
          <img src={images[lbIdx]} className={styles.lightboxImg} alt="" onClick={e => e.stopPropagation()} />
          {images.length > 1 && (
            <>
              <button className={`${styles.lightboxArrow} ${styles.lightboxArrowL}`} onClick={e => { e.stopPropagation(); setLbIdx(i => (i - 1 + images.length) % images.length) }}><i className="ri-arrow-left-s-line" /></button>
              <button className={`${styles.lightboxArrow} ${styles.lightboxArrowR}`} onClick={e => { e.stopPropagation(); setLbIdx(i => (i + 1) % images.length) }}><i className="ri-arrow-right-s-line" /></button>
              <span className={styles.lightboxCounter}>{lbIdx + 1} / {images.length}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
