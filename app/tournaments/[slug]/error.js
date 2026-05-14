'use client'
export default function Error({ error }) {
  return (
    <div style={{ padding: 20, color: 'red', fontSize: 13, wordBreak: 'break-all' }}>
      <b>Client error:</b><br />
      {error?.message}<br /><br />
      <pre style={{ fontSize: 11, overflow: 'auto' }}>{error?.stack}</pre>
    </div>
  )
}