'use client'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { useOnlineUsers, useOnlineZones } from '../../lib/usePresence'
import { ZONES, getZone } from '../../lib/siteZones'
import { formatLastSeen } from '../../lib/lastSeen'
import useTranslation from '../../lib/useTranslation'
import styles from './page.module.css'

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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('lobbyMap.title') || 'Lobby Map'}</h1>
        <div className={styles.liveCount}>
          <span className={styles.liveDot} />
          {totalOnline} {t('lobbyMap.online') || 'online now'}
        </div>
      </div>

      <div className={styles.mapWrap}>
        <div className={styles.map}>
          {ZONES.map(zone => {
            const bucket = grouped.get(zone.id) || { online: [], offline: [] }
            const total = bucket.online.length + bucket.offline.length
            const shown = [...bucket.online, ...bucket.offline].slice(0, 3)
            return (
              <button
                key={zone.id}
                className={styles.zoneNode}
                style={{ left: `${zone.x}%`, top: `${zone.y}%`, '--zone-color': zone.color }}
                onClick={() => setActiveZone(zone.id)}
              >
                <div className={styles.zoneIcon}>
                  <i className={zone.icon} />
                  {bucket.online.length > 0 && <span className={styles.zonePulse} />}
                </div>
                <span className={styles.zoneLabel}>{zone.label}</span>
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
      </div>

      {!loading && profiles.length === 0 && (
        <p className={styles.empty}>{t('lobbyMap.empty') || 'No recent activity to show yet.'}</p>
      )}

      {activeZone && activeZoneData && (
        <div className={styles.sheetOverlay} onClick={() => setActiveZone(null)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetHeader}>
              <i className={getZone(activeZone).icon} style={{ color: getZone(activeZone).color }} />
              <h2>{getZone(activeZone).label}</h2>
            </div>
            <div className={styles.sheetList}>
              {activeZoneData.online.length === 0 && activeZoneData.offline.length === 0 && (
                <p className={styles.empty}>{t('lobbyMap.noOne') || 'No one here right now.'}</p>
              )}
              {activeZoneData.online.map(p => (
                <div key={p.id} className={styles.sheetRow}>
                  <img src={p.avatar_url || '/default-avatar.png'} alt={p.username} className={styles.sheetAvatar} />
                  <div className={styles.sheetInfo}>
                    <span className={styles.sheetName}>{p.username}</span>
                    <span className={styles.sheetStatusOnline}>{t('lobbyMap.activeNow') || 'Active now'}</span>
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
