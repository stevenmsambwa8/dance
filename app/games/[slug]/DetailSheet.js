'use client'
import Link from 'next/link'
import styles from './modals.module.css'

function fmtFee(n) { return Number(n).toLocaleString() }

export default function DetailSheet({ selected, onClose, isJoined, isFull, selectedHasFee, selectedPending, onPay, onRegister }) {
  if (!selected) return null
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}><i className="ri-close-line" /></button>
        <h3 className={styles.detailTitle}>{selected.name}</h3>
        {selected.format && <p className={styles.detailFormat}>{selected.format}</p>}
        {isJoined && <div className={styles.joinedBanner}><i className="ri-checkbox-circle-fill" /> You're registered for this tournament</div>}
        {selectedPending && !isJoined && <div className={styles.pendingBanner}><i className="ri-time-line" /> Payment submitted — awaiting admin approval</div>}
        <div className={styles.tGrid}>
          {[
            { label: 'Status',     val: selected.status,                                                     icon: 'ri-live-line' },
            { label: 'Prize Pool', val: selected.prize || 'None',                                            icon: 'ri-trophy-line' },
            { label: 'Entry Fee',  val: selectedHasFee ? `TZS ${fmtFee(selected.entrance_fee)}` : 'Free',   icon: 'ri-money-dollar-circle-line' },
            { label: 'Slots',      val: `${selected.registered_count || 0} / ${selected.slots}`,             icon: 'ri-group-line' },
            { label: 'Date',       val: selected.date || 'TBD',                                              icon: 'ri-calendar-line' },
          ].map(r => (
            <div key={r.label} className={styles.tGridRow}>
              <span className={styles.tGridLabel}><i className={r.icon} /> {r.label}</span>
              <span className={styles.tGridVal}>{r.val}</span>
            </div>
          ))}
        </div>
        {!isJoined && !selectedPending && !isFull && (
          <p className={styles.tNote}>By registering you agree to tournament rules. No-shows result in a loss of entry points.</p>
        )}
        <div className={styles.detailActions}>
          <Link href={`/tournaments/${selected.slug || selected.id}`} className={styles.viewBtn}>
            <i className="ri-eye-line" /> View Bracket
          </Link>
          {!isJoined && !isFull && !selectedPending && (
            selectedHasFee ? (
              <button className={styles.joinBtn} onClick={onPay}>
                <i className="ri-money-dollar-circle-line" /> Pay & Register · TZS {fmtFee(selected.entrance_fee)}
              </button>
            ) : (
              <button className={styles.joinBtn} onClick={onRegister}>
                <i className="ri-trophy-line" /> Register Now
              </button>
            )
          )}
          {isFull && !isJoined && <span className={styles.fullNote}><i className="ri-lock-line" /> Tournament is full</span>}
        </div>
      </div>
    </div>
  )
}
