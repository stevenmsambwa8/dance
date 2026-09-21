'use client'
import styles from './SubscribeButton.module.css'

// YouTube-style subscribe pill: solid "Subscribe" → grey "Subscribed" with a bell.
// variant="dark" is for use on dark/image backgrounds.
export default function SubscribeButton({
  subscribed,
  onClick,
  disabled,
  size = 'md',
  variant = 'default',
  block = false,
  className = '',
  subscribeLabel = 'Subscribe',
  subscribedLabel = 'Subscribed',
}) {
  const cls = [
    styles.btn,
    subscribed ? styles.on : '',
    size === 'sm' ? styles.sm : '',
    variant === 'dark' ? styles.dark : '',
    block ? styles.block : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-pressed={!!subscribed}>
      {subscribed && <i className="ri-notification-3-line" />}
      {subscribed ? subscribedLabel : subscribeLabel}
    </button>
  )
}
