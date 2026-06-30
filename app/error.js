'use client'

export default function GlobalError({ error, reset }) {
  return (
    <html>
      <body style={{ padding: 20, fontFamily: 'monospace', background: '#fff', color: '#111' }}>
        <h2 style={{ color: '#dc2626', marginBottom: 12 }}>Something broke 👇</h2>
        <p style={{ fontWeight: 'bold', marginBottom: 8 }}>{error?.message || 'Unknown error'}</p>
        {error?.digest && (
          <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>Digest: {error.digest}</p>
        )}
        <pre style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: '#f3f4f6',
          padding: 12,
          borderRadius: 8,
          fontSize: 12,
          maxHeight: '50vh',
          overflow: 'auto',
        }}>
          {error?.stack || 'No stack trace available'}
        </pre>
        <button
          onClick={() => reset()}
          style={{
            marginTop: 16,
            padding: '10px 20px',
            background: '#111',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
