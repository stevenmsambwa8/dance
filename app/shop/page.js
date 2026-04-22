'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../components/Modal'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'

const CATS = ['all', 'accounts', 'gear', 'services']
const MAX_IMAGES = 4
const TARGET_KB  = 60
const MAX_DIM    = 1200

async function compressToWebP(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
        width  = Math.round(width  * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      const target = TARGET_KB * 1024
      async function search() {
        let lo = 0.05, hi = 0.92, best = null
        const attempt = q => new Promise(res => canvas.toBlob(b => res(b), 'image/webp', q))
        let blob = await attempt(hi)
        if (blob.size <= target) { resolve(blob); return }
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2
          blob = await attempt(mid)
          if (blob.size <= target) { best = blob; lo = mid }
          else { hi = mid }
        }
        if (!best) best = await attempt(lo)
        resolve(best)
      }
      search().catch(reject)
    }
    img.onerror = reject
    img.src = url
  })
}

function SkeletonCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonImg} />
      <div className={styles.skeletonBody}>
        <div className={styles.skeletonLine} style={{ width: '30%' }} />
        <div className={styles.skeletonLine} style={{ width: '70%' }} />
        <div className={styles.skeletonLine} style={{ width: '50%' }} />
        <div className={styles.skeletonLine} style={{ width: '40%', marginTop: 8 }} />
      </div>
    </div>
  )
}

export default function Shop() {
  const { user, isAdmin } = useAuth()
  const router = useRouter()
  const [cat, setCat]         = useState('all')
  const [items, setItems]     = useState([])
  const [itemImages, setItemImages] = useState({})
  const [sellModal, setSellModal]   = useState(false)
  const [editModal, setEditModal]   = useState(null)
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)
  const [listing, setListing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm]       = useState({ title: '', price: '', category: 'accounts', description: '' })
  const [editForm, setEditForm] = useState({ title: '', price: '', category: 'accounts', description: '' })
  const [pendingFiles, setPendingFiles]       = useState([])
  const [pendingPreviews, setPendingPreviews] = useState([])
  const [compressing, setCompressing]         = useState(false)
  // per-card buy loading state: itemId → true/false
  const [buying, setBuying] = useState({})
  const fileInputRef = useRef(null)

  useEffect(() => { loadItems() }, [cat])

  async function loadItems() {
    setLoading(true)
    let query = supabase
      .from('shop_items')
      .select('id, seller_id, title, price, category, description, active, created_at, profiles(username, tier, level)')
      .eq('active', true)
      .order('created_at', { ascending: false })
    if (cat !== 'all') query = query.eq('category', cat)
    const { data } = await query
    setItems(data || [])
    setLoading(false)
    if (data?.length) {
      const ids = data.map(i => i.id)
      const { data: imgs } = await supabase
        .from('shop_item_images')
        .select('item_id, url, sort_order')
        .in('item_id', ids)
        .order('sort_order', { ascending: true })
      if (imgs) {
        const map = {}
        imgs.forEach(img => { if (!map[img.item_id]) map[img.item_id] = []; map[img.item_id].push(img.url) })
        setItemImages(map)
      }
    }
  }

  // Auto-create request and navigate straight to chat
  async function handleBuyNow(item, e) {
    e.stopPropagation()
    if (!user) { router.push('/login'); return }
    setBuying(b => ({ ...b, [item.id]: true }))
    const { data: myProfile } = await supabase.from('profiles').select('username').eq('id', user.id).single()
    const senderName = myProfile?.username || user.email?.split('@')[0]
    // Check for existing pending/accepted request first
    const { data: existing } = await supabase
      .from('buy_requests')
      .select('id, status')
      .eq('item_id', item.id)
      .eq('buyer_id', user.id)
      .in('status', ['pending', 'accepted', 'payment_submitted', 'admin_approved', 'payout_pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) {
      router.push(`/shop/${item.id}/request/${existing.id}`)
      return
    }
    const { data: req, error } = await supabase
      .from('buy_requests')
      .insert({
        item_id: item.id,
        buyer_id: user.id,
        seller_id: item.seller_id,
        offer_price: Number(String(item.price).replace(/[^0-9.]/g, '')),
        note: `Hi, I want to buy "${item.title}"`,
        status: 'pending',
      })
      .select().single()
    if (error) { setBuying(b => ({ ...b, [item.id]: false })); alert(error.message); return }
    await supabase.from('notifications').insert({
      user_id: item.seller_id,
      type: 'buy_request',
      title: 'New buy request',
      body: `${senderName} wants to buy "${item.title}" for TZS ${item.price}`,
      meta: { request_id: req.id, item_id: item.id },
      read: false,
    })
    router.push(`/shop/${item.id}/request/${req.id}`)
  }

  function handleFilePick(e) {
    const files = Array.from(e.target.files || [])
    const remaining = MAX_IMAGES - pendingFiles.length
    const picked = files.slice(0, remaining)
    setPendingFiles(prev => [...prev, ...picked])
    setPendingPreviews(prev => [...prev, ...picked.map(f => URL.createObjectURL(f))])
    e.target.value = ''
  }

  function removeImage(idx) {
    URL.revokeObjectURL(pendingPreviews[idx])
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
    setPendingPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  function resetModal() {
    pendingPreviews.forEach(u => URL.revokeObjectURL(u))
    setPendingFiles([]); setPendingPreviews([])
    setSellModal(false)
  }

  async function listItem() {
    if (!user) return alert('Log in to sell items')
    if (!form.title || !form.price) return alert('Title and price are required')
    setListing(true)
    const { data: item, error } = await supabase
      .from('shop_items')
      .insert({ seller_id: user.id, title: form.title, price: form.price, category: form.category, description: form.description, active: true })
      .select().single()
    if (error) { alert(error.message); setListing(false); return }
    if (pendingFiles.length > 0) {
      setCompressing(true)
      for (let i = 0; i < pendingFiles.length; i++) {
        try {
          const blob = await compressToWebP(pendingFiles[i])
          const path = `shop/${item.id}/${Date.now()}_${i}.webp`
          const { error: upErr } = await supabase.storage.from('shop-images').upload(path, blob, { contentType: 'image/webp' })
          if (!upErr) {
            const { data: { publicUrl } } = supabase.storage.from('shop-images').getPublicUrl(path)
            await supabase.from('shop_item_images').insert({ item_id: item.id, url: publicUrl, sort_order: i })
          }
        } catch (_) {}
      }
      setCompressing(false)
    }
    setListing(false)
    setForm({ title: '', price: '', category: 'accounts', description: '' })
    resetModal()
    loadItems()
  }

  function openEdit(item, e) {
    e?.stopPropagation()
    setEditForm({ title: item.title, price: item.price, category: item.category, description: item.description || '' })
    setEditModal(item)
  }

  async function saveEdit() {
    if (!editModal) return
    setSaving(true)
    const { error } = await supabase.from('shop_items').update({
      title: editForm.title, price: editForm.price,
      category: editForm.category, description: editForm.description,
    }).eq('id', editModal.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setEditModal(null); loadItems()
  }

  async function deleteItem(item, e) {
    e?.stopPropagation()
    if (!confirm(`Delete "${item.title}"?`)) return
    await supabase.from('shop_items').update({ active: false }).eq('id', item.id)
    loadItems()
  }

  const canManage = (item) => item && user && (user.id === item.seller_id || isAdmin)
  const fmtPrice  = (p) => { const n = Number(String(p || '').replace(/[^0-9.]/g, '')); return isNaN(n) || n <= 0 ? p : n.toLocaleString() }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Marketplace · TZS</p>
          <h1 className={styles.headline}>Shop</h1>
        </div>
        {user && (
          <button className={styles.sellBtn} onClick={() => setSellModal(true)}>
            <i className="ri-price-tag-3-line" /> Sell Item
          </button>
        )}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {CATS.map(c => (
            <button
              key={c}
              className={`${styles.filter} ${cat === c ? styles.activeFilter : ''}`}
              onClick={() => setCat(c)}
            >
              {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
        {!loading && <span className={styles.itemCount}>{items.length} {items.length === 1 ? 'item' : 'items'}</span>}
      </div>

      <div className={styles.list}>
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : items.length === 0
            ? (
              <div className={styles.empty}>
                <i className="ri-store-2-line" />
                <p>No items here yet</p>
                <span>Be the first to list something in this category</span>
              </div>
            )
            : items.map(item => {
              const imgs  = itemImages[item.id] || []
              const isOwn = user && user.id === item.seller_id
              const isBuying = buying[item.id]
              return (
                <div
                  key={item.id}
                  className={styles.card}
                  onClick={() => router.push(`/shop/${item.id}`)}
                >
                  <div className={styles.cardImgWrap}>
                    {imgs.length > 0
                      ? <img src={imgs[0]} alt={item.title} className={styles.cardImg} />
                      : <div className={styles.cardImgEmpty}><i className="ri-image-line" /></div>
                    }
                    {imgs.length > 1 && (
                      <span className={styles.imgCount}><i className="ri-image-2-line" /> {imgs.length}</span>
                    )}
                    <span className={styles.catChip}>{item.category}</span>
                  </div>

                  <div className={styles.cardBody}>
                    <div className={styles.cardMeta}>
                      <span className={styles.seller}><i className="ri-user-line" />{item.profiles?.username || 'Unknown'}</span>
                    </div>
                    <h3 className={styles.itemTitle}>{item.title}</h3>
                    {item.description && <p className={styles.itemDesc}>{item.description}</p>}

                    <div className={styles.cardFooter}>
                      <span className={styles.itemPrice}>TZS {fmtPrice(item.price)}</span>
                      <div className={styles.cardActions} onClick={e => e.stopPropagation()}>
                        {canManage(item) && (
                          <>
                            <button className={styles.iconBtn} onClick={e => openEdit(item, e)} title="Edit"><i className="ri-edit-line" /></button>
                            <button className={`${styles.iconBtn} ${styles.iconDel}`} onClick={e => deleteItem(item, e)} title="Delete"><i className="ri-delete-bin-line" /></button>
                          </>
                        )}
                        {isOwn ? (
                          <button className={styles.viewBtn} onClick={e => { e.stopPropagation(); router.push(`/shop/${item.id}`) }}>
                            <i className="ri-eye-line" /> View
                          </button>
                        ) : (
                          <button
                            className={styles.buyNowBtn}
                            disabled={isBuying}
                            onClick={e => handleBuyNow(item, e)}
                          >
                            {isBuying
                              ? <><i className="ri-loader-4-line" style={{ animation: 'spin .7s linear infinite' }} /> Opening…</>
                              : <><i className="ri-shopping-bag-line" /> Buy Now</>
                            }
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
        }
      </div>

      {/* Edit Modal */}
      <Modal open={!!editModal} onClose={() => setEditModal(null)} title="Edit Listing" size="sm"
        footer={<button className={styles.buyBtn} onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : <><i className="ri-check-line" /> Save Changes</>}</button>}
      >
        <div className={styles.sellForm}>
          <div className={styles.sellField}><label>Title</label><input type="text" value={editForm.title} onChange={e => setEditForm(x => ({ ...x, title: e.target.value }))} /></div>
          <div className={styles.sellField}><label>Price (TZS)</label><input type="text" value={editForm.price} onChange={e => setEditForm(x => ({ ...x, price: e.target.value }))} /></div>
          <div className={styles.sellField}><label>Category</label>
            <select value={editForm.category} onChange={e => setEditForm(x => ({ ...x, category: e.target.value }))}>
              <option value="accounts">Account</option><option value="gear">Gear</option><option value="services">Service</option>
            </select>
          </div>
          <div className={styles.sellField}><label>Description</label><textarea rows={4} value={editForm.description} onChange={e => setEditForm(x => ({ ...x, description: e.target.value }))} /></div>
        </div>
      </Modal>

      {/* Sell Modal */}
      <Modal open={sellModal} onClose={resetModal} title="List an Item" size="sm"
        footer={
          <button className={styles.buyBtn} onClick={listItem} disabled={listing || compressing}>
            {listing || compressing
              ? <><i className="ri-loader-4-line" style={{ animation: 'spin .7s linear infinite' }} /> {compressing ? 'Compressing…' : 'Listing…'}</>
              : <><i className="ri-price-tag-3-line" /> List for Sale</>}
          </button>
        }
      >
        <div className={styles.sellForm}>
          <div className={styles.sellField}><label>Title</label><input type="text" placeholder="Item name" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div className={styles.sellField}><label>Price (TZS)</label><input type="text" placeholder="0" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} /></div>
          <div className={styles.sellField}><label>Category</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              <option value="accounts">Account</option><option value="gear">Gear</option><option value="services">Service</option>
            </select>
          </div>
          <div className={styles.sellField}><label>Description</label><textarea rows={3} placeholder="Describe your item..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className={styles.sellField}>
            <label>Photos&nbsp;<span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>{pendingFiles.length}/{MAX_IMAGES} · auto-compressed to 60 KB WebP</span></label>
            <div className={styles.imgUploadRow}>
              {pendingPreviews.map((src, i) => (
                <div key={i} className={styles.imgThumb}>
                  <img src={src} alt="" />
                  <button className={styles.imgRemove} onClick={() => removeImage(i)} type="button"><i className="ri-close-line" /></button>
                  {i === 0 && <span className={styles.imgCoverBadge}>Cover</span>}
                </div>
              ))}
              {pendingFiles.length < MAX_IMAGES && (
                <button className={styles.imgAdd} onClick={() => fileInputRef.current?.click()} type="button">
                  <i className="ri-add-line" /><span>Add</span>
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFilePick} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
