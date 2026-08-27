'use client'
import { useEffect } from 'react'
import styles from './ProductDrawer.module.css'

const CATS = [
  { value: 'accounts', label: 'Account' },
  { value: 'gear',     label: 'Gear' },
  { value: 'services', label: 'Service' },
]

/**
 * ProductDrawer — left sidebar (65vw) for listing / editing a shop item.
 * Replaces the old bottom-sheet Modal for this flow.
 *
 * Props:
 *   open          boolean
 *   mode          'add' | 'edit'
 *   onClose       fn
 *   onSubmit      fn
 *   submitting    boolean
 *   compressing   boolean (only meaningful in 'add' mode)
 *   form          { title, price, category, description }
 *   setForm       fn
 *   showPhotos    boolean — only 'add' mode uploads photos
 *   pendingFiles, pendingPreviews, maxImages
 *   onPick, onRemoveImage, fileInputRef
 */
export default function ProductDrawer({
  open, mode = 'add', onClose, onSubmit, submitting, compressing,
  form, setForm,
  showPhotos, pendingFiles = [], pendingPreviews = [], maxImages = 4,
  onPick, onRemoveImage, fileInputRef,
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <span className={styles.eyebrow}>{mode === 'edit' ? 'Edit Listing' : 'New Listing'}</span>
            <h2>{mode === 'edit' ? 'Update Item' : 'List an Item'}</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} type="button">
            <i className="ri-close-line" />
          </button>
        </div>

        {mode === 'add' && (
          <div className={styles.testBanner}>
            <i className="ri-flask-line" />
            <div>
              <strong>Test Mode</strong>
              <span>Selling is open to everyone while the shop is being tested. List real items only — test or fake listings will be removed.</span>
            </div>
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.field}>
            <label>Title</label>
            <input
              type="text"
              placeholder="Item name"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className={styles.field}>
            <label>Price (TZS)</label>
            <input
              type="text"
              placeholder="0"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            />
          </div>

          <div className={styles.field}>
            <label>Category</label>
            <div className={styles.catPicker}>
              {CATS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`${styles.catChip} ${form.category === c.value ? styles.catChipActive : ''}`}
                  onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label>Description</label>
            <textarea
              rows={4}
              placeholder="Describe your item..."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {showPhotos && (
            <div className={styles.field}>
              <label>
                Photos
                <span className={styles.hint}>{pendingFiles.length}/{maxImages} · auto-compressed to WebP</span>
              </label>
              <div className={styles.imgRow}>
                {pendingPreviews.map((src, i) => (
                  <div key={i} className={styles.imgThumb}>
                    <img src={src} alt="" />
                    <button type="button" className={styles.imgRemove} onClick={() => onRemoveImage(i)}>
                      <i className="ri-close-line" />
                    </button>
                    {i === 0 && <span className={styles.coverBadge}>Cover</span>}
                  </div>
                ))}
                {pendingFiles.length < maxImages && (
                  <button type="button" className={styles.imgAdd} onClick={() => fileInputRef.current?.click()}>
                    <i className="ri-add-line" />
                    <span>Add</span>
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={onPick}
              />
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">Cancel</button>
          <button className={styles.submitBtn} onClick={onSubmit} disabled={submitting} type="button">
            {submitting
              ? <><i className="ri-loader-4-line" style={{ animation: 'spin .7s linear infinite' }} /> {compressing ? 'Compressing…' : mode === 'edit' ? 'Saving…' : 'Listing…'}</>
              : <><i className={mode === 'edit' ? 'ri-check-line' : 'ri-price-tag-3-line'} /> {mode === 'edit' ? 'Save Changes' : 'List for Sale'}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
