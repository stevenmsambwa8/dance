// Root loading boundary. Without this file, Next.js App Router keeps the OLD
// page on screen until the NEW route has fully loaded (and dynamic routes
// like /games/[slug] can't be prefetched at all). With it, navigation
// switches instantly and this skeleton shows while the page's JS/data arrive.
export default function Loading() {
  return (
    <div style={{ padding: '20px 16px', display: 'grid', gap: 14 }}>
      {[72, 140, 140, 96].map((h, i) => (
        <div
          key={i}
          style={{
            height: h,
            borderRadius: 14,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            opacity: 0.7,
            animation: 'navSkeletonPulse 1.1s ease-in-out infinite alternate',
          }}
        />
      ))}
      <style>{`@keyframes navSkeletonPulse{from{opacity:.45}to{opacity:.85}}`}</style>
    </div>
  )
}
