'use client'
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import styles from './page.module.css'

// World is an abstract 1000x1000 unit square — zone x/y (0-100 %) map onto it 1:1 * 10.
// Leaflet's Simple CRS has lat increasing upward, so we flip y.
const WORLD = 1000
function toLatLng(xPct, yPct) {
  return [WORLD - (yPct / 100) * WORLD, (xPct / 100) * WORLD]
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function isDarkTheme() {
  if (typeof document === 'undefined') return false
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

// A seamless grass "ground" texture generated as an SVG data URI —
// no image asset needed, and it pans/zooms perfectly with the map content
// because it's a real imageOverlay, not a CSS background.
function buildGroundUrl(dark) {
  const top = dark ? '#24402a' : '#d7f0bb'
  const bottom = dark ? '#1a2f1e' : '#bfe3a0'
  const stripe = dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)'
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='${WORLD}' height='${WORLD}'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stop-color='${top}'/>
          <stop offset='100%' stop-color='${bottom}'/>
        </linearGradient>
        <pattern id='stripes' width='16' height='16' patternTransform='rotate(45)' patternUnits='userSpaceOnUse'>
          <rect width='8' height='16' fill='${stripe}'/>
        </pattern>
      </defs>
      <rect width='${WORLD}' height='${WORLD}' fill='url(#g)'/>
      <rect width='${WORLD}' height='${WORLD}' fill='url(#stripes)'/>
    </svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const DECOS = [
  { type: 'bush', x: 4, y: 50 },
  { type: 'bush', x: 96, y: 52 },
  { type: 'pond', x: 65, y: 30 },
  { type: 'bush', x: 35, y: 70 },
]

function buildZoneIconHtml(zone, bucket, onlineIds, t) {
  const total = bucket.online.length + bucket.offline.length
  const shown = [...bucket.online, ...bucket.offline].slice(0, 3)
  const avatarsHtml = total > 0 ? `
    <div class="${styles.avatarStack}">
      ${shown.map(p => `<img src="${escapeHtml(p.avatar_url || '/default-avatar.png')}" alt="" class="${styles.avatar} ${onlineIds.has(p.id) ? styles.avatarOnline : styles.avatarOffline}" />`).join('')}
      ${total > shown.length ? `<span class="${styles.avatarMore}">+${total - shown.length}</span>` : ''}
    </div>` : ''
  return `
    <div class="${styles.zoneNode}" style="position:static;transform:none;padding:0;">
      <div class="${styles.zoneHut}">
        <div class="${styles.zoneRoof}" style="border-bottom-color:${zone.color}"></div>
        <div class="${styles.zoneBody}" style="border-color:${zone.color};color:${zone.color}">
          <i class="${zone.icon}"></i>
          ${bucket.online.length > 0 ? `<span class="${styles.zonePulse}"></span>` : ''}
        </div>
      </div>
      <span class="${styles.zoneLabel}">${escapeHtml(t(zone.labelKey))}</span>
      ${avatarsHtml}
    </div>`
}

export default function LobbyMapCanvas({ zones, grouped, onlineIds, t, onZoneClick }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map())
  const baseZoomRef = useRef(0)
  const onZoneClickRef = useRef(onZoneClick)
  const [zoomPct, setZoomPct] = useState(100)

  onZoneClickRef.current = onZoneClick

  // ── One-time map init ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const bounds = L.latLngBounds([0, 0], [WORLD, WORLD])
    const dark = isDarkTheme()

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: 0,
      maxZoom: 4,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      attributionControl: false,
      zoomControl: false,
      maxBoundsViscosity: 0.85,
    })
    map.setMaxBounds(bounds.pad(0.15))
    map.fitBounds(bounds)
    baseZoomRef.current = map.getZoom()
    setZoomPct(100)

    L.imageOverlay(buildGroundUrl(dark), bounds).addTo(map)

    // Decorative dirt paths, Home → every other zone
    const home = zones.find(z => z.id === 'home')
    zones.filter(z => z.id !== 'home' && z.id !== 'other').forEach(z => {
      L.polyline([toLatLng(home.x, home.y), toLatLng(z.x, z.y)], {
        color: dark ? '#7a5c3c' : '#b98a5a',
        weight: 2,
        dashArray: '6 8',
        opacity: 0.55,
        interactive: false,
      }).addTo(map)
    })

    // Decorative bushes/pond
    DECOS.forEach(d => {
      L.marker(toLatLng(d.x, d.y), {
        icon: L.divIcon({
          className: 'lobbymap-deco',
          html: `<span class="${d.type === 'bush' ? styles.decoBush : styles.decoPond}"></span>`,
          iconSize: [46, 30],
          iconAnchor: [23, 15],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(map)
    })

    // Zone huts
    zones.forEach(zone => {
      const bucket = grouped.get(zone.id) || { online: [], offline: [] }
      const marker = L.marker(toLatLng(zone.x, zone.y), {
        icon: L.divIcon({
          className: 'lobbymap-zone',
          html: buildZoneIconHtml(zone, bucket, onlineIds, t),
          iconSize: [78, 92],
          iconAnchor: [39, 46],
        }),
        keyboard: false,
      }).addTo(map)
      marker.on('click', () => onZoneClickRef.current?.(zone.id))
      markersRef.current.set(zone.id, marker)
    })

    map.on('zoom', () => {
      setZoomPct(Math.round(100 * Math.pow(2, map.getZoom() - baseZoomRef.current)))
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; markersRef.current.clear() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Live presence updates — just refresh each marker's icon, no re-init ──
  useEffect(() => {
    zones.forEach(zone => {
      const marker = markersRef.current.get(zone.id)
      if (!marker) return
      const bucket = grouped.get(zone.id) || { online: [], offline: [] }
      marker.setIcon(L.divIcon({
        className: 'lobbymap-zone',
        html: buildZoneIconHtml(zone, bucket, onlineIds, t),
        iconSize: [78, 92],
        iconAnchor: [39, 46],
      }))
    })
  }, [zones, grouped, onlineIds, t])

  function zoomIn() { mapRef.current?.zoomIn(0.5) }
  function zoomOut() { mapRef.current?.zoomOut(0.5) }
  function resetView() {
    if (!mapRef.current) return
    mapRef.current.fitBounds(L.latLngBounds([0, 0], [WORLD, WORLD]))
  }

  return (
    <div className={styles.mapWrap}>
      <div ref={containerRef} className={styles.leafletHost} />
      <div className={styles.zoomControls}>
        <button className={styles.zoomBtn} onClick={zoomIn} aria-label="Zoom in">
          <i className="ri-add-line" />
        </button>
        <button className={styles.zoomBtn} onClick={zoomOut} aria-label="Zoom out">
          <i className="ri-subtract-line" />
        </button>
        <button className={styles.zoomBtn} onClick={resetView} aria-label="Reset view">
          <i className="ri-focus-3-line" />
        </button>
      </div>
      <div className={styles.zoomBadge}>{zoomPct}%</div>
    </div>
  )
}
