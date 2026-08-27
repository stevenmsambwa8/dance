'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'
import { useCurrency } from '../../lib/useCurrency'
import ProductDrawer from '../../components/ProductDrawer'

const CATS = ['all', 'accounts', 'gear', 'services']
const MAX_IMAGES = 4
const TARGET_KB  = 60
const MAX_DIM    = 1200
const EMPTY_FORM = { title: '', price: '', category: 'accounts', description: '' }

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

function SkeletonTile() {
  return (
    <div className={styles.tile}>
      <div className={`${styles.tileImgWrap} ${styles.skeletonShimmer}`} />
      <div className={styles.tileBody}>
        <div className={`${styles.skeletonLine} ${styles.skeletonShimmer}`} style={{ width: '40%' }} />
        <div className={`${styles.skeletonLine} ${styles.skeletonShimmer}`} style={{ width: '85%' }} />
        <div className={`${styles.skeletonLine} ${styles.skeletonShimmer}`} style={{ width: '55%', marginTop: 6 }} />
      </div>
    </div>
  )
}

export default function Shop() {
  const { user, isAdmin, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const { fmtAmt, currency } = useCurrency(profile?.country_flag)
  const router = useRouter()
  const [cat, setCat]         = useState('all')
  const [items, setItems]     = useState([])
  const [itemImages, setItemImages] = useState({})
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)

  // Unified drawer state — null | 'add' | 'edit'
  const [drawerMode, setDrawerMode] = useState(null)
  const [editingId, setEditingId]   = useState(null)
  const [form, setForm]             = useState(EMPTY_FORM)

  const [listing, setListing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [pendingFiles, setPendingFiles]       = useState([])
  const [pendingPreviews, setPendingPreviews] = useState([])
  const [compressing, setCompressing]         = useState(false)
  // per-card buy loading state: itemId → true/false
  const [buying, setBuying] = useState({})
  const fileInputRef = useRef(null)

  // Selling is open to everyone who's logged in — no plan gate (Test Mode)
  const canSell = !!user

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
    if (!user) { openAuthGate(); return }
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

  function openAdd() {
    if (!user) { openAuthGate(); return }
    setForm(EMPTY_FORM)
    setEditingId(null)
    setDrawerMode('add')
  }

  function openEdit(item, e) {
    e?.stopPropagation()
    setForm({ title: item.title, price: item.price, category: item.category, description: item.description || '' })
    setEditingId(item.id)
    setDrawerMode('edit')
  }

  function closeDrawer() {
    pendingPreviews.forEach(u => URL.revokeObjectURL(u))
    setPendingFiles([]); setPendingPreviews([])
    setDrawerMode(null)
    setEditingId(null)
    setForm(EMPTY_FORM)
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
    closeDrawer()
    loadItems()
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    const { error } = await supabase.from('shop_items').update({
      title: form.title, price: form.price,
      category: form.category, description: form.description,
    }).eq('id', editingId)
    setSaving(false)
    if (error) { alert(error.message); return }
    closeDrawer()
    loadItems()
  }

  async function deleteItem(item, e) {
    e?.stopPropagation()
    if (!confirm(`Delete "${item.title}"?`)) return
    await supabase.from('shop_items').update({ active: false }).eq('id', item.id)
    loadItems()
  }

  const canManage = (item) => item && user && (user.id === item.seller_id || isAdmin)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Marketplace · {currency}</p>
          <h1 className={styles.headline}>Shop</h1>
          <span className={styles.testTag}><i className="ri-flask-line" /> Open to everyone — Test Mode</span>
        </div>
        {user && (
          <button className={styles.sellBtn} onClick={openAdd}>
            <i className="ri-add-line" /> Sell Item
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

      <div className={styles.grid}>
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonTile key={i} />)
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
                  className={styles.tile}
                  onClick={() => router.push(`/shop/${item.id}`)}
                >
                  <div className={styles.tileImgWrap}>
                    {imgs.length > 0
                      ? <img src={imgs[0]} alt={item.title} className={styles.tileImg} />
                      : <div className={styles.tileImgEmpty}><i className="ri-image-line" /></div>
                    }
                    <span className={styles.tileCat}>{item.category}</span>
                    {imgs.length > 1 && (
                      <span className={styles.tileImgCount}><i className="ri-image-2-line" /> {imgs.length}</span>
                    )}
                    {canManage(item) && (
                      <div className={styles.tileActions} onClick={e => e.stopPropagation()}>
                        <button className={styles.tileIconBtn} onClick={e => openEdit(item, e)} title="Edit"><i className="ri-edit-line" /></button>
                        <button className={`${styles.tileIconBtn} ${styles.tileIconDel}`} onClick={e => deleteItem(item, e)} title="Delete"><i className="ri-delete-bin-line" /></button>
                      </div>
                    )}
                  </div>

                  <div className={styles.tileBody}>
                    <span className={styles.tileSeller}><i className="ri-user-line" />{item.profiles?.username || 'Unknown'}</span>
                    <h3 className={styles.tileTitle}>{item.title}</h3>

                    <div className={styles.tileFooter}>
                      <span className={styles.tilePrice}>{fmtAmt(Number(String(item.price).replace(/[^0-9.]/g,'')))}</span>
                      <div onClick={e => e.stopPropagation()}>
                        {isOwn ? (
                          <button className={styles.tileView} onClick={e => { e.stopPropagation(); router.push(`/shop/${item.id}`) }}>
                            View
                          </button>
                        ) : (
                          <button
                            className={styles.tileBuy}
                            disabled={isBuying}
                            onClick={e => handleBuyNow(item, e)}
                            title="Buy Now"
                          >
                            <i className={isBuying ? 'ri-loader-4-line' : 'ri-shopping-bag-line'} style={isBuying ? { animation: 'spin .7s linear infinite' } : undefined} />
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

      <ProductDrawer
        open={drawerMode !== null}
        mode={drawerMode || 'add'}
        onClose={closeDrawer}
        onSubmit={drawerMode === 'edit' ? saveEdit : listItem}
        submitting={drawerMode === 'edit' ? saving : (listing || compressing)}
        compressing={compressing}
        form={form}
        setForm={setForm}
        showPhotos={drawerMode === 'add'}
        pendingFiles={pendingFiles}
        pendingPreviews={pendingPreviews}
        maxImages={MAX_IMAGES}
        onPick={handleFilePick}
        onRemoveImage={removeImage}
        fileInputRef={fileInputRef}
      />
    </div>
  )
}
