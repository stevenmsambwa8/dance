'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { useOnlineUsers, useOnlineZones } from '../../lib/usePresence'
import { ZONES, getZone } from '../../lib/siteZones'
import { formatLastSeen } from '../../lib/lastSeen'
import useTranslation from '../../lib/useTranslation'
import styles from './page.module.css'

// Leaflet touches window/document at import time, so it can never run
// during SSR - load it client-only.
const LobbyMapCanvas = dynamic(() => import('./LobbyMapCanvas'), {
  ssr: false,
  loading: () => <div className={styles.mapWrap} />,
})

export default function LobbyMapPage() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const onlineIds = useOnlineUsers()
  const onlineZones = useOnlineZones()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeZone, setActiveZone] = useState(null)

  useEffect(() => {
    let mounted = true
    async function load() {
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
    const interval = setInterval(load, 60_000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('lobbyMap.title')}</h1>
        <div className={styles.liveCount}>
          <span className={styles.liveDot} />
          {totalOnline} {t('lobbyMap.online')}
        </div>
      </div>

      <LobbyMapCanvas
        zones={ZONES}
        grouped={grouped}
        onlineIds={onlineIds}
        t={t}
        onZoneClick={setActiveZone}
      />

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
