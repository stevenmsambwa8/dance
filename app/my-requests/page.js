'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'

function fmtPrice(val) {
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? '—' : n.toLocaleString()
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_COLOR = { pending: '#f59e0b', accepted: '#22c55e', declined: '#ef4444', completed: '#6366f1' }
const STATUS_LABEL = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined', completed: 'Completed' }

const FILTERS = ['all', 'pending', 'accepted', 'declined', 'completed']

export default function MyRequestsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  usePageLoading(authLoading || loading)
  const [filter, setFilter]     = useState('all')
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    if (authLoading) return          // wait for session restore
    if (!user) { router.push('/login'); return }
    loadRequests()

    // Realtime: status updates reflect immediately
    const ch = supabase
      .channel('my-buy-requests')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'buy_requests',
        filter: `buyer_id=eq.${user.id}`,
      }, () => loadRequests())
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'buy_requests',
        filter: `buyer_id=eq.${user.id}`,
      }, () => loadRequests())
      .subscribe()

    return () => supabase.removeChannel(ch)
  }, [user, authLoading])

  async function loadRequests() {
    setLoading(true)
    const { data, error } = await supabase
      .from('buy_requests')
      .select(`
        id, item_id, offer_price, note, status, created_at,
        shop_items(id, title, category, price, active,
          profiles!shop_items_seller_id_fkey(username, tier, level, avatar_url)
        )
      `)
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false })

    if (error) console.error('my-requests error:', error.message)
    setRequests(data || [])
    setLoading(false)
  }

  async function deleteRequest(reqId) {
    if (!confirm('Delete this request? This cannot be undone.')) return
    setDeleting(reqId)
    // Delete associated negotiation messages first
    await supabase.from('negotiation_messages').delete().eq('request_id', reqId)
    await supabase.from('buy_requests').delete().eq('id', reqId).eq('buyer_id', user.id)
    setRequests(prev => prev.filter(r => r.id !== reqId))
    setDeleting(null)
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)

  const counts = FILTERS.reduce((acc, f) => {
    acc[f] = f === 'all' ? requests.length : requests.filter(r => r.status === f).length
    return acc
  }, {})

  if (authLoading) return null
  if (!user) return null

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}><i className="ri-file-list-3-line" /> My Requests</h1>
          <p className={styles.subtitle}>Track all your buy requests and negotiations</p>
        </div>
        <Link href="/shop" className={styles.shopBtn}>
          <i className="ri-store-2-line" /> Browse Shop
        </Link>
      </div>

      {/* Filter tabs */}
      <div className={styles.filters}>
        {FILTERS.map(f => (
          <button
            key={f}
            className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {counts[f] > 0 && (
              <span
                className={styles.filterCount}
                style={filter === f && f !== 'all' ? { background: STATUS_COLOR[f] } : {}}
              >
                {counts[f]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && null}

      {!loading && filtered.length === 0 && (
        <div className={styles.empty}>
          <i className="ri-inbox-line" />
          <p>{filter === 'all' ? "You haven't sent any buy requests yet." : `No ${filter} requests.`}</p>
          {filter === 'all' && (
            <Link href="/shop" className={styles.emptyBtn}>
              <i className="ri-store-2-line" /> Go to Shop
            </Link>
          )}
        </div>
      )}

      <div className={styles.list}>
        {filtered.map(req => {
          const item    = req.shop_items
          const seller  = item?.profiles
          const color   = STATUS_COLOR[req.status] || '#999'
          const label   = STATUS_LABEL[req.status] || req.status

          return (
            <div key={req.id} className={styles.card}>
              <div className={styles.cardBody}>
                {/* Top row */}
                <div className={styles.cardTop}>
                  <div className={styles.cardItem}>
                    <span className={styles.cardCategory}>{item?.category || 'Item'}</span>
                    <span className={styles.cardTitle}>{item?.title || 'Unknown item'}</span>
                  </div>
                  <div className={styles.statusPill} style={{ color, borderColor: color + '40', background: color + '12' }}>
                    <span className={styles.statusDot} style={{ background: color }} />
                    {label}
                  </div>
                </div>

                {/* Offer + Asking price */}
                <div className={styles.priceRow}>
                  <div className={styles.priceBlock}>
                    <span className={styles.priceLabel}>Your Offer</span>
                    <span className={styles.priceValue}>TZS {fmtPrice(req.offer_price)}</span>
                  </div>
                  {item?.price && (
                    <div className={styles.priceBlock}>
                      <span className={styles.priceLabel}>Asking</span>
                      <span className={styles.priceAsk}>TZS {fmtPrice(item.price)}</span>
                    </div>
                  )}
                </div>

                {/* Note */}
                {req.note && (
                  <p className={styles.note}>"{req.note}"</p>
                )}

                {/* Seller row */}
                {seller && (
                  <div className={styles.sellerRow}>
                    <div className={styles.sellerAvatar}>
                      {seller.avatar_url
                        ? <img src={seller.avatar_url} alt="" />
                        : <span>{seller.username?.[0]?.toUpperCase() || '?'}</span>
                      }
                    </div>
                    <div className={styles.sellerInfo}>
                      <span className={styles.sellerName}>{seller.username}</span>
                      {seller.tier && <span className={styles.sellerTier}>{seller.tier}{seller.level ? ` · Lv.${seller.level}` : ''}</span>}
                    </div>
                    <span className={styles.timeAgo}>{timeAgo(req.created_at)}</span>
                  </div>
                )}

                {/* Actions */}
                <div className={styles.cardActions}>
                  <Link href={`/shop/${req.item_id}/request/${req.id}`} className={styles.viewBtn}>
                    <i className="ri-chat-3-line" /> View Details &amp; Chat
                  </Link>
                  <Link href={`/shop/${req.item_id}`} className={styles.listingBtn}>
                    <i className="ri-store-2-line" /> See Listing
                  </Link>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => deleteRequest(req.id)}
                    disabled={deleting === req.id}
                    title="Delete request"
                  >
                    {deleting === req.id
                      ? <span className={styles.deletingSpinner} />
                      : <i className="ri-delete-bin-6-line" />
                    }
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
