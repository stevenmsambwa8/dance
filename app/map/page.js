'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { useOnlineUsers, useOnlineZones } from '../../lib/usePresence'
import { ZONES, getZone } from '../../lib/siteZones'
import { formatLastSeen } from '../../lib/lastSeen'
import useTranslation from '../../lib/useTranslation'
import styles from './page.module.css'

const MIN_SCALE = 0.6
const MAX_SCALE = 2.8
const HOME_ZONE = ZONES.find(z => z.id === 'home')
const PATH_ZONES = ZONES.filter(z => z.id !== 'home' && z.id !== 'other')

function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export default function LobbyMapPage() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const onlineIds = useOnlineUsers()
  const onlineZones = useOnlineZones()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeZone, setActiveZone] = useState(null)
  const [zoomPct, setZoomPct] = useState(100)

  const wrapRef = useRef(null)
  const mapRef = useRef(null)
  const gesture = useRef({
    pointers: new Map(),
    scale: 1,
    x: 0,
    y: 0,
    panStart: null,
    pinchStartDist: 0,
    pinchStartScale: 1,
    moved: false,
  })

  useEffect(() => {
    let mounted = true
    async function load() {
      // Recently-active window keeps this cheap at scale — online users
      // always show live via the presence channel regardless of this filter.
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, tier, last_seen, last_zone')
        .gte('last_seen', since)
        .order('last_seen', { ascending: false })
        .limit(300)
      if (mounted) {
        setProfiles(data || [])
        setLoading(false)
      }
    }
    load()
    // Light refresh so newly-active offline users trickle in without a full realtime sub
    const interval = setInterval(load, 60_000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  // Group every known profile into its current (if online) or last-known (if offline) zone
  const grouped = useMemo(() => {
    const map = new Map(ZONES.map(z => [z.id, { online: [], offline: [] }]))
    for (const p of profiles) {
      const isOnline = onlineIds.has(p.id)
      const zoneId = isOnline ? (onlineZones.get(p.id) || 'other') : (p.last_zone || 'other')
      const bucket = map.get(zoneId) || map.get('other')
      if (isOnline) bucket.online.push(p)
      else bucket.offline.push(p)
    }
    return map
  }, [profiles, onlineIds, onlineZones])

  const totalOnline = onlineIds.size
  const activeZoneData = activeZone ? grouped.get(activeZone) : null

  // ── Pan / pinch-zoom — direct DOM transform writes, no re-render per frame ──
  function applyTransform() {
    const g = gesture.current
    if (mapRef.current) {
      mapRef.current.style.transform = `translate3d(${g.x}px, ${g.y}px, 0) scale(${g.scale})`
    }
  }

  function handlePointerDown(e) {
    wrapRef.current?.setPointerCapture(e.pointerId)
    const g = gesture.current
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    g.moved = false
    if (g.pointers.size === 1) {
      const p = [...g.pointers.values()][0]
      g.panStart = { x: p.x, y: p.y, mapX: g.x, mapY: g.y }
    } else if (g.pointers.size === 2) {
      const pts = [...g.pointers.values()]
      g.pinchStartDist = dist(pts[0], pts[1])
      g.pinchStartScale = g.scale
      g.panStart = null
    }
  }

  function handlePointerMove(e) {
    const g = gesture.current
    if (!g.pointers.has(e.pointerId)) return
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...g.pointers.values()]
    if (pts.length === 1 && g.panStart) {
      const dx = pts[0].x - g.panStart.x
      const dy = pts[0].y - g.panStart.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) g.moved = true
      g.x = g.panStart.mapX + dx
      g.y = g.panStart.mapY + dy
      applyTransform()
    } else if (pts.length === 2) {
      g.moved = true
      const d = dist(pts[0], pts[1])
      g.scale = clampScale(g.pinchStartScale * (d / g.pinchStartDist))
      applyTransform()
    }
  }

  function handlePointerUp(e) {
    const g = gesture.current
    g.pointers.delete(e.pointerId)
    if (g.pointers.size === 1) {
      const p = [...g.pointers.values()][0]
      g.panStart = { x: p.x, y: p.y, mapX: g.x, mapY: g.y }
    } else if (g.pointers.size === 0) {
      g.panStart = null
    }
    setZoomPct(Math.round(g.scale * 100))
  }

  function handleWheel(e) {
    e.preventDefault()
    const g = gesture.current
    const factor = e.deltaY > 0 ? 0.92 : 1.08
    g.scale = clampScale(g.scale * factor)
    applyTransform()
    setZoomPct(Math.round(g.scale * 100))
  }

  function zoomBy(factor) {
    const g = gesture.current
    g.scale = clampScale(g.scale * factor)
    applyTransform()
    setZoomPct(Math.round(g.scale * 100))
  }

  function resetView() {
    const g = gesture.current
    g.scale = 1
    g.x = 0
    g.y = 0
    applyTransform()
    setZoomPct(100)
  }

  // Prevent a drag/pinch gesture from also registering as a zone tap
  function handleZoneClick(zoneId) {
    if (gesture.current.moved) return
    setActiveZone(zoneId)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('lobbyMap.title')}</h1>
        <div className={styles.liveCount}>
          <span className={styles.liveDot} />
          {totalOnline} {t('lobbyMap.online')}
        </div>
      </div>

      <div
        className={styles.mapWrap}
        ref={wrapRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <div className={styles.map} ref={mapRef}>
          {/* Decorative dirt paths connecting Home to every other zone — purely visual */}
          <svg className={styles.pathsSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
            {PATH_ZONES.map(zone => (
              <line
                key={zone.id}
                x1={HOME_ZONE.x} y1={HOME_ZONE.y}
                x2={zone.x} y2={zone.y}
                className={styles.dirtPath}
              />
            ))}
          </svg>

          {/* Decorative bushes/pond — CSS only, no image assets */}
          <span className={`${styles.deco} ${styles.decoBush}`} style={{ left: '4%', top: '50%' }} aria-hidden="true" />
          <span className={`${styles.deco} ${styles.decoBush}`} style={{ left: '96%', top: '52%' }} aria-hidden="true" />
          <span className={`${styles.deco} ${styles.decoPond}`} style={{ left: '65%', top: '30%' }} aria-hidden="true" />
          <span className={`${styles.deco} ${styles.decoBush}`} style={{ left: '35%', top: '70%' }} aria-hidden="true" />

          {ZONES.map(zone => {
            const bucket = grouped.get(zone.id) || { online: [], offline: [] }
            const total = bucket.online.length + bucket.offline.length
            const shown = [...bucket.online, ...bucket.offline].slice(0, 3)
            return (
              <button
                key={zone.id}
                className={styles.zoneNode}
                style={{ left: `${zone.x}%`, top: `${zone.y}%`, '--zone-color': zone.color }}
                onClick={() => handleZoneClick(zone.id)}
              >
                <div className={styles.zoneHut}>
                  <div className={styles.zoneRoof} />
                  <div className={styles.zoneBody}>
                    <i className={zone.icon} />
                    {bucket.online.length > 0 && <span className={styles.zonePulse} />}
                  </div>
                </div>
                <span className={styles.zoneLabel}>{t(zone.labelKey)}</span>
                {total > 0 && (
                  <div className={styles.avatarStack}>
                    {shown.map(p => (
                      <img
                        key={p.id}
                        src={p.avatar_url || '/default-avatar.png'}
                        alt={p.username}
                        className={`${styles.avatar} ${onlineIds.has(p.id) ? styles.avatarOnline : styles.avatarOffline}`}
                      />
                    ))}
                    {total > shown.length && (
                      <span className={styles.avatarMore}>+{total - shown.length}</span>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Zoom controls — siblings of the transformed map, so they stay fixed on screen */}
        <div className={styles.zoomControls}>
          <button className={styles.zoomBtn} onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            <i className="ri-add-line" />
          </button>
          <button className={styles.zoomBtn} onClick={() => zoomBy(0.8)} aria-label="Zoom out">
            <i className="ri-subtract-line" />
          </button>
          <button className={styles.zoomBtn} onClick={resetView} aria-label="Reset view">
            <i className="ri-focus-3-line" />
          </button>
        </div>
        <div className={styles.zoomBadge}>{zoomPct}%</div>
      </div>

      {!loading && profiles.length === 0 && (
        <p className={styles.empty}>{t('lobbyMap.empty')}</p>
      )}

      {activeZone && activeZoneData && (
        <div className={styles.sheetOverlay} onClick={() => setActiveZone(null)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetHeader}>
              <i className={getZone(activeZone).icon} style={{ color: getZone(activeZone).color }} />
              <h2>{t(getZone(activeZone).labelKey)}</h2>
            </div>
            <div className={styles.sheetList}>
              {activeZoneData.online.length === 0 && activeZoneData.offline.length === 0 && (
                <p className={styles.empty}>{t('lobbyMap.noOne')}</p>
              )}
              {activeZoneData.online.map(p => (
                <div key={p.id} className={styles.sheetRow}>
                  <img src={p.avatar_url || '/default-avatar.png'} alt={p.username} className={styles.sheetAvatar} />
                  <div className={styles.sheetInfo}>
                    <span className={styles.sheetName}>{p.username}</span>
                    <span className={styles.sheetStatusOnline}>{t('lobbyMap.activeNow')}</span>
                  </div>
                </div>
              ))}
              {activeZoneData.offline.map(p => (
                <div key={p.id} className={`${styles.sheetRow} ${styles.sheetRowOffline}`}>
                  <img src={p.avatar_url || '/default-avatar.png'} alt={p.username} className={styles.sheetAvatar} />
                  <div className={styles.sheetInfo}>
                    <span className={styles.sheetName}>{p.username}</span>
                    <span className={styles.sheetStatusOffline}>{formatLastSeen(p.last_seen)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
