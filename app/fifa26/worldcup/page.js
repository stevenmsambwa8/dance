'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import styles from './page.module.css'

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

const NAME_TO_ISO = {
  'Mexico':'mx','South Africa':'za','South Korea':'kr','Korea Republic':'kr',
  'Czechia':'cz','Czech Republic':'cz','Canada':'ca',
  'Bosnia and Herzegovina':'ba','Qatar':'qa','Switzerland':'ch',
  'Spain':'es','Croatia':'hr','Morocco':'ma','Belgium':'be',
  'USA':'us','United States':'us','Paraguay':'py','Australia':'au',
  'Türkiye':'tr','Turkey':'tr','Germany':'de','Portugal':'pt',
  'Colombia':'co','Argentina':'ar','Brazil':'br','Ecuador':'ec',
  'Nigeria':'ng','Sweden':'se','France':'fr','Uruguay':'uy',
  'Algeria':'dz','Chile':'cl','Netherlands':'nl','Senegal':'sn',
  'IR Iran':'ir','Iran':'ir','Japan':'jp','Italy':'it',
  'Venezuela':'ve',"Côte d'Ivoire":'ci','Ivory Coast':'ci','Iraq':'iq',
  'England':'gb-eng','Egypt':'eg','Uzbekistan':'uz','DR Congo':'cd',
  'Ghana':'gh','Slovakia':'sk','Cape Verde':'cv','Curaçao':'cw',
  'Serbia':'rs','Saudi Arabia':'sa','Denmark':'dk','Greece':'gr',
}

const EAT = 'Africa/Nairobi'

function FlagImg({ url, name, size = 32 }) {
  const [useFallback, setUseFallback] = useState(false)
  const iso = NAME_TO_ISO[name]
  const src = (!useFallback && url) ? url : (iso ? `https://flagcdn.com/w40/${iso}.png` : null)
  if (!src) return <div style={{ width:size, height:Math.round(size*0.67), borderRadius:3, background:'var(--bg-2)', border:'1px solid var(--border)', flexShrink:0 }} />
  return (
    <img src={src} alt={name} width={size} height={Math.round(size*0.67)}
      style={{ width:size, height:Math.round(size*0.67), objectFit:'cover', borderRadius:3, flexShrink:0 }}
      onError={() => { if (!useFallback && url) setUseFallback(true) }}
    />
  )
}

function fmtDate(str) {
  if (!str || str === 'TBD') return 'TBD'
  // Parse as YYYY-MM-DD in EAT context
  const [y, m, d] = str.split('-').map(Number)
  if (!y || !m || !d) return str
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  if (isNaN(dt)) return str
  return dt.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    timeZone: EAT
  })
}

export default function WorldCupLivePage() {
  const router = useRouter()
  const [tab, setTab]                   = useState('fixtures')
  const [games, setGames]               = useState([])
  const [teamMap, setTeamMap]           = useState({})
  const [groupsData, setGroupsData]     = useState([])
  const [loading, setLoading]           = useState(false)
  const [lastFetched, setLastFetched]   = useState(null)
  const [fixtureGroup, setFixtureGroup] = useState('all')
  const [standingsGroup, setStandingsGroup] = useState('A')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, gRes, mRes] = await Promise.all([
        fetch('/api/worldcup?endpoint=get/teams'),
        fetch('/api/worldcup?endpoint=get/groups'),
        fetch('/api/worldcup?endpoint=get/games'),
      ])

      if (tRes.ok) {
        const tj = await tRes.json()
        const teams = tj.teams || []
        const map = {}
        teams.forEach(t => { map[t.id || t._id] = t })
        setTeamMap(map)
      }

      if (gRes.ok) {
        const gj = await gRes.json()
        setGroupsData(gj.groups || [])
      }

      if (mRes.ok) {
        const mj = await mRes.json()
        setGames(mj.games || [])
      }

      setLastFetched(new Date())
    } catch (e) { console.warn('fetch error', e) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function enrichGame(g) {
    const homeTeam = teamMap[g.home_team_id] || {}
    const awayTeam = teamMap[g.away_team_id] || {}

    const homeName    = g.home_team_name_en || homeTeam.name_en || '—'
    const awayName    = g.away_team_name_en || awayTeam.name_en || '—'
    const homeFlagUrl = homeTeam.flag || null
    const awayFlagUrl = awayTeam.flag || null

    const rawDate = g.local_date || g.date || ''
    const dt = rawDate ? new Date(rawDate) : null

    // Date in EAT (so day boundaries are correct for East Africa)
    const date = dt && !isNaN(dt)
      ? dt.toLocaleDateString('en-CA', { timeZone: EAT }) // → YYYY-MM-DD
      : 'TBD'

    // Time in EAT
    const time = dt && !isNaN(dt)
      ? dt.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: EAT
        })
      : ''

    const groupLetter = (g.group || homeTeam.groups || '').toUpperCase()

    return {
      id: g._id || g.id,
      date, time,
      home: homeName, away: awayName,
      homeFlagUrl, awayFlagUrl,
      groupLetter,
      matchday: g.matchday || '',
      score1: g.home_score ?? 0,
      score2: g.away_score ?? 0,
      hasScore: g.finished === true,
      isFinished: g.finished === true,
      venue: g.local || g.stadium_name || '',
    }
  }

  const enriched      = games.map(enrichGame)
  const groupGames    = enriched.filter(g => g.groupLetter)
  const activeGroups  = [...new Set(groupGames.map(g => g.groupLetter).filter(Boolean))].sort()
  const displayGroups = activeGroups.length ? activeGroups : GROUPS

  const filtered = fixtureGroup === 'all'
    ? groupGames
    : groupGames.filter(g => g.groupLetter === fixtureGroup)

  const byDate = filtered.reduce((acc, g) => {
    const d = g.date || 'TBD'
    if (!acc[d]) acc[d] = []
    acc[d].push(g)
    return acc
  }, {})
  const sortedDates = Object.keys(byDate).sort((a,b) =>
    a==='TBD'?1:b==='TBD'?-1:a.localeCompare(b)
  )

  const currentGroupData = groupsData.find(g =>
    (g.group || g.name || '').toUpperCase() === standingsGroup
  )
  const standingsRows = currentGroupData
    ? [...(currentGroupData.teams || [])]
        .map(row => {
          const t = teamMap[row.team_id] || {}
          return { ...row, name: t.name_en || '—', flag: t.flag || null }
        })
        .sort((a,b) => (b.pts||0)-(a.pts||0) || (b.gd||0)-(a.gd||0) || (b.gf||0)-(a.gf||0))
    : []

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.push('/fifa26')}>← Back</button>
        <div className={styles.headerCenter}>
          <img src="https://flagcdn.com/w40/us.png" alt="WC" width={28} height={19}
            style={{ borderRadius:3, objectFit:'cover', flexShrink:0 }} />
          <div>
            <div className={styles.headerName}>World Cup 2026</div>
            <div className={styles.headerSub}>Official results & standings</div>
          </div>
        </div>
        <button className={styles.refreshBtn} onClick={fetchData}>↻</button>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {[{key:'fixtures',label:'📅 Fixtures'},{key:'table',label:'📊 Table'}].map(({key,label}) => (
          <button key={key}
            className={`${styles.tab} ${tab===key?styles.tabActive:''}`}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
      </div>

      {loading && <div className={styles.loading}><span className={styles.spinner} />Loading…</div>}

      {/* FIXTURES */}
      {!loading && tab === 'fixtures' && (
        <div className={styles.section}>
          <div className={styles.pills}>
            {['all',...displayGroups].map(g => (
              <button key={g}
                className={`${styles.pill} ${fixtureGroup===g?styles.pillActive:''}`}
                onClick={() => setFixtureGroup(g)}
              >{g==='all'?'All':`Grp ${g}`}</button>
            ))}
          </div>

          {sortedDates.length === 0 && (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>📅</div>
              <p>No fixtures available yet.</p>
            </div>
          )}

          {sortedDates.map(date => (
            <div key={date} className={styles.dayBlock}>
              <div className={styles.dayLabel}>{fmtDate(date)}</div>
              {byDate[date].map((m,i) => (
                <div key={m.id||i}
                  className={`${styles.matchCard} ${m.isFinished?styles.matchCardDone:''}`}
                >
                  <div className={styles.matchMeta}>
                    {m.groupLetter && <span className={styles.groupTag}>Group {m.groupLetter}</span>}
                    {m.matchday    && <span className={styles.mdTag}>MD{m.matchday}</span>}
                  </div>
                  <div className={styles.matchRow}>
                    <div className={styles.matchTeam}>
                      <FlagImg url={m.homeFlagUrl} name={m.home} size={30} />
                      <span className={styles.matchName}>{m.home}</span>
                    </div>
                    <div className={styles.matchMid}>
                      {m.hasScore
                        ? <span className={styles.score}>{m.score1} – {m.score2}</span>
                        : <span className={styles.ko}>{m.time || '–'}</span>
                      }
                      {m.isFinished && <span className={styles.ftBadge}>FT</span>}
                    </div>
                    <div className={`${styles.matchTeam} ${styles.matchTeamR}`}>
                      <FlagImg url={m.awayFlagUrl} name={m.away} size={30} />
                      <span className={styles.matchName}>{m.away}</span>
                    </div>
                  </div>
                  {m.venue && <div className={styles.venue}>📍 {m.venue}</div>}
                </div>
              ))}
            </div>
          ))}

          {lastFetched && (
            <div className={styles.lastFetched}>
              Updated {lastFetched.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: EAT
              })} EAT
            </div>
          )}
        </div>
      )}

      {/* TABLE */}
      {!loading && tab === 'table' && (
        <div className={styles.section}>
          <div className={styles.pills}>
            {displayGroups.map(g => (
              <button key={g}
                className={`${styles.pill} ${standingsGroup===g?styles.pillActive:''}`}
                onClick={() => setStandingsGroup(g)}
              >Group {g}</button>
            ))}
          </div>

          {standingsRows.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>📊</div>
              <p>No matches played yet — standings appear once games kick off.</p>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <div className={styles.tableGroupLabel}>Group {standingsGroup}</div>
              <div className={styles.tableGrid}>
                <div className={styles.tableRowHdr}>
                  <span className={styles.tPos}>#</span>
                  <span className={styles.tTeam}>Team</span>
                  <span className={styles.tStat}>MP</span>
                  <span className={styles.tStat}>W</span>
                  <span className={styles.tStat}>D</span>
                  <span className={styles.tStat}>L</span>
                  <span className={styles.tStat}>GF</span>
                  <span className={styles.tStat}>GA</span>
                  <span className={styles.tGD}>GD</span>
                  <span className={styles.tPts}>PTS</span>
                </div>
                {standingsRows.map((row,idx) => (
                  <div key={row.team_id||idx}
                    className={`${styles.tableRow} ${idx<2?styles.tableRowQ:''}`}
                  >
                    <span className={`${styles.tPos} ${idx<2?styles.tPosQ:''}`}>{idx+1}</span>
                    <span className={styles.tTeam}>
                      <FlagImg url={row.flag} name={row.name} size={22} />
                      <span className={styles.tName}>{row.name}</span>
                    </span>
                    <span className={styles.tStat}>{row.mp||0}</span>
                    <span className={styles.tStat}>{row.w||0}</span>
                    <span className={styles.tStat}>{row.d||0}</span>
                    <span className={styles.tStat}>{row.l||0}</span>
                    <span className={styles.tStat}>{row.gf||0}</span>
                    <span className={styles.tStat}>{row.ga||0}</span>
                    <span className={`${styles.tGD} ${(row.gd||0)>0?styles.gdPos:(row.gd||0)<0?styles.gdNeg:''}`}>
                      {(row.gd||0)>0?`+${row.gd}`:row.gd||0}
                    </span>
                    <span className={styles.tPts}>{row.pts||0}</span>
                  </div>
                ))}
              </div>
              <div className={styles.tableLegend}>
                <span className={styles.legendDot} /> Qualify for Round of 32
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}