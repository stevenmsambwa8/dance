'use client'

import { useEffect, useRef, useState } from 'react'

const W = 1080

const GAME_META = {
  pubg:         { name: 'PUBG MOBILE',     color: '#f97316', img: '/games/pubg.png'        },
  freefire:     { name: 'FREE FIRE',       color: '#ef4444', img: '/games/freefire.png'    },
  codm:         { name: 'CALL OF DUTY',    color: '#94a3b8', img: '/games/callofduty.png'  },
  maleo_bussid: { name: 'MALEO BUSSID',   color: '#22c55e', img: '/games/maleo.png'       },
  efootball:    { name: 'eFOOTBALL',       color: '#00ff66', img: '/games/efootball.png'   },
  dls:          { name: 'DLS 26',          color: '#8b5cf6', img: '/games/dls.png'         },
  ufl:          { name: 'UFL',             color: '#06b6d4', img: '/games/ufl.png'         },
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function getRoundLabel(rIdx, totalRounds) {
  const fromEnd = (totalRounds - 2) - rIdx
  if (fromEnd === 0) return 'FINAL'
  if (fromEnd === 1) return 'SEMI FINAL'
  if (fromEnd === 2) return 'QUARTER FINAL'
  if (fromEnd === 3) return 'ROUND OF 16'
  return `ROUND ${rIdx + 1}`
}

function loadImg(src) {
  return new Promise(resolve => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve(img)
    img.onerror = () => resolve(null)
    setTimeout(() => resolve(null), 3000)
    img.src = src
  })
}

function drawSlot(ctx, x, y, w, h, slot, opponentWon, accentColor) {
  const name   = slot?.name  || (slot?.status === 'open' ? 'Open' : '?')
  const isBye  = slot?.status === 'bye'
  const isWin  = slot?.status === 'winner'
  const isElim = opponentWon && !isWin
  const isPend = !slot?.userId && !isBye

  if (isWin) {
    ctx.fillStyle = accentColor
    ctx.fillRect(x, y, 6, h)
  }

  ctx.globalAlpha = isElim ? 0.35 : 1

  const PAD  = 16
  const avR  = 15 
  const avCX = x + PAD + avR + (isWin ? 6 : 0)
  const avCY = y + h / 2

  // Avatar Base
  ctx.beginPath()
  ctx.arc(avCX, avCY, avR, 0, Math.PI * 2)
  ctx.fillStyle = isWin ? '#ffffff' : 'rgba(0,0,0,0.4)'
  ctx.fill()
  ctx.strokeStyle = isWin ? '#ffffff' : 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Avatar Initials
  ctx.font = '800 12px system-ui, sans-serif'
  ctx.fillStyle = isWin ? '#000000' : '#94a3b8'
  ctx.textAlign = 'center'
  ctx.fillText(isBye ? '—' : isPend ? '?' : name.slice(0, 2).toUpperCase(), avCX, avCY + 4)

  // --- DYNAMIC TEXT WRAPPING LOGIC ---
  ctx.font = '800 14px system-ui, sans-serif'
  const textStartX = avCX + avR + 14
  // Max width avoids the right edge (and the "WIN" badge if applicable)
  const maxTextW = w - (textStartX - x) - (isWin ? 45 : 16)
  const displayText = isBye ? 'BYE' : isPend ? 'TBD' : name.toUpperCase()
  
  // Step 1: Split by spaces
  const words = displayText.split(' ')
  let lines = []
  let currentLine = ''

  for (let i = 0; i < words.length; i++) {
    const testLine = currentLine + (currentLine ? ' ' : '') + words[i]
    if (ctx.measureText(testLine).width > maxTextW && i > 0) {
      lines.push(currentLine)
      currentLine = words[i]
    } else {
      currentLine = testLine
    }
  }
  lines.push(currentLine)

  // Step 2: Force break long character strings without spaces
  const finalLines = []
  lines.forEach(line => {
    if (ctx.measureText(line).width > maxTextW) {
      let temp = ''
      for (const char of line) {
        if (ctx.measureText(temp + char).width > maxTextW) {
          finalLines.push(temp)
          temp = char
        } else {
          temp += char
        }
      }
      if (temp) finalLines.push(temp)
    } else {
      finalLines.push(line)
    }
  })

  // Limit to 3 lines maximum so it doesn't bleed out of the box
  const renderLines = finalLines.slice(0, 3)

  // Step 3: Auto-center vertically
  const lineHeight = 17
  const totalTextH = renderLines.length * lineHeight
  // Optically adjust baseline (+5)
  const startY = avCY - (totalTextH / 2) + (lineHeight / 2) + 5 

  ctx.fillStyle = isBye ? '#475569' : isWin ? '#ffffff' : '#e2e8f0'
  ctx.textAlign = 'left'
  renderLines.forEach((l, i) => {
    ctx.fillText(l, textStartX, startY + i * lineHeight)
  })

  ctx.globalAlpha = 1

  // "WIN" Badge
  if (isWin) {
    ctx.font = '900 13px system-ui, sans-serif'
    ctx.fillStyle = accentColor
    ctx.textAlign = 'right'
    ctx.fillText('WIN', x + w - PAD, y + h / 2 + 5)
  }
}

async function drawCard(canvas, { tournament, bracketData, participants, gameMeta }) {
  const ctx = canvas.getContext('2d')
  
  const rounds      = bracketData?.rounds?.slice(0, -1) ?? []
  const totalRounds = bracketData?.rounds?.length ?? 1
  const accent      = gameMeta?.color || '#00ff66'

  let champion = null
  const finalRound = bracketData?.rounds?.[totalRounds - 2]
  if (finalRound) {
    const champ = (finalRound[0] || []).find(s => s?.status === 'winner')
    if (champ?.name && champ.name !== '?' && champ.name !== 'TBD') champion = champ
  }

  const prize    = tournament?.prize
  const prizeNum = prize ? Number(String(prize).replace(/[^0-9.]/g, '')) : null
  const hasPrize = prizeNum && !isNaN(prizeNum) && prizeNum > 0

  // ── PRECISE DYNAMIC HEIGHT CALCULATION ──
  const PAD = 56
  const MATCH_H = 100 // Increased height slightly to accommodate wrapped text
  const MATCH_GAP = 32 
  const visRounds = rounds.slice(0, 4)
  const cols = visRounds.length || 1
  const colGap = 32
  const colW = (W - PAD * 2 - colGap * (cols - 1)) / cols

  let y = 64 // Starting Y for content
  const [logo, gameImg] = await Promise.all([
    loadImg('/logo.png'),
    gameMeta?.img ? loadImg(gameMeta.img) : Promise.resolve(null),
  ])

  // Calculate Header Box Size
  let headerH = y
  headerH += (logo?.naturalWidth > 0 ? 44 + 50 : 40) // Logo space
  headerH += 32 // Subtitle 
  headerH += 90 // Main Title
  headerH += 45 // Game Name
  headerH += 86 // Stat Pills
  headerH += 40 // Divider spacing
  if (champion) headerH += 170 // Champion Podium space

  // Calculate Bracket Space
  const r0Count = visRounds[0]?.length || 1
  const bracketTotalHeight = r0Count * MATCH_H + Math.max(0, r0Count - 1) * MATCH_GAP

  // Final Canvas Height (Tight wrap around content + Footer)
  const footerH = 100
  const H = headerH + bracketTotalHeight + footerH
  
  canvas.width  = W
  canvas.height = H

  // ── RENDER FULL-BLEED BACKGROUND & OVERLAY ──
  ctx.fillStyle = '#06070d'
  ctx.fillRect(0, 0, W, H)

  if (gameImg) {
    ctx.save()
    // Scale image to cover entire canvas
    const scale = Math.max(W / gameImg.naturalWidth, H / gameImg.naturalHeight)
    const dw = gameImg.naturalWidth * scale
    const dh = gameImg.naturalHeight * scale
    const dx = (W - dw) / 2
    const dy = (H - dh) / 2
    
    ctx.drawImage(gameImg, dx, dy, dw, dh)
    ctx.restore()

    // Cinematic Overlay Gradient to ensure text readability
    const overlayGrad = ctx.createLinearGradient(0, 0, 0, H)
    overlayGrad.addColorStop(0, 'rgba(6, 7, 13, 0.70)')   
    overlayGrad.addColorStop(0.5, 'rgba(6, 7, 13, 0.85)') 
    overlayGrad.addColorStop(1, 'rgba(6, 7, 13, 0.95)')   
    ctx.fillStyle = overlayGrad
    ctx.fillRect(0, 0, W, H)
  }

  // ── HEADER TYPOGRAPHY ──
  // Logo & URL
  if (logo?.naturalWidth > 0) {
    const logoR = 22
    ctx.save()
    ctx.beginPath()
    ctx.arc(PAD + logoR, y + logoR, logoR, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(logo, PAD, y, logoR * 2, logoR * 2)
    ctx.restore()

    ctx.font = '800 16px system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.fillText('WWW.NABOGAMING.LIVE', PAD + logoR * 2 + 16, y + logoR + 6)
    y += logoR * 2 + 50
  } else {
    y += 40
  }

  ctx.font = '900 15px system-ui, sans-serif'
  ctx.fillStyle = accent
  ctx.letterSpacing = '0.3em'
  ctx.fillText('TOURNAMENT BRACKET', PAD, y)
  y += 32

  ctx.font = '900 76px system-ui, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.letterSpacing = '0px'
  const titleText = (tournament?.name || 'CHAMPIONSHIP').toUpperCase()
  ctx.fillText(titleText, PAD, y + 60)
  y += 90

  ctx.font = '800 26px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.fillText((gameMeta?.name || '').toUpperCase(), PAD, y)
  y += 45

  const stats = [
    { label: `${participants?.length || 0} CONTENDERS`, bg: 'rgba(255,255,255,0.1)', text: '#ffffff' },
    ...(hasPrize ? [{ label: `PRIZE POOL: TZS ${prizeNum.toLocaleString()}`, bg: accent, text: '#000000' }] : []),
  ]
  
  let pillX = PAD
  stats.forEach(s => {
    ctx.font = '900 14px system-ui, sans-serif'
    const textW = ctx.measureText(s.label).width
    const pillW = textW + 40
    const pillH = 46
    
    rr(ctx, pillX, y, pillW, pillH, 6)
    ctx.fillStyle = s.bg
    ctx.fill()
    if (s.bg.includes('rgba')) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'
        ctx.stroke()
    }

    ctx.fillStyle = s.text
    ctx.textAlign = 'center'
    ctx.fillText(s.label, pillX + pillW / 2, y + pillH / 2 + 5)
    pillX += pillW + 16
  })
  y += 46 + 40

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke()
  y += 40

  // ── CHAMPION BLOCK ──
  if (champion) {
    const cH = 120
    rr(ctx, PAD, y, W - PAD * 2, cH, 8)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = accent
    ctx.fillRect(PAD, y, 10, cH)

    const tx = PAD + 36
    const centerY = y + cH / 2
    
    ctx.font = '900 12px system-ui, sans-serif'
    ctx.fillStyle = accent
    ctx.letterSpacing = '0.2em'
    ctx.fillText('WINNER CHAMPION', tx, centerY - 16)
    
    ctx.font = '900 36px system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.letterSpacing = '0px'
    ctx.fillText(champion.name.toUpperCase(), tx, centerY + 20)

    ctx.font = '38px serif'
    ctx.textAlign = 'right'
    ctx.fillText('👑', W - PAD - 36, centerY + 14)
    
    y += cH + 50
  }

  // ── BRACKET TREE ──
  const matchPositions = []
  
  matchPositions[0] = visRounds[0]?.map((_, mIdx) => ({
    x: PAD,
    y: y + mIdx * (MATCH_H + MATCH_GAP)
  })) || []

  for (let r = 1; r < cols; r++) {
    matchPositions[r] = visRounds[r]?.map((_, mIdx) => {
      const p1 = matchPositions[r - 1][mIdx * 2]
      const p2 = matchPositions[r - 1][mIdx * 2 + 1]
      return {
        x: PAD + r * (colW + colGap),
        y: p2 ? (p1.y + p2.y) / 2 : p1.y
      }
    }) || []
  }

  ctx.save()
  visRounds.forEach((pairs, rIdx) => {
    if (rIdx === visRounds.length - 1) return

    pairs.forEach((_, mIdx) => {
      const currentPos = matchPositions[rIdx][mIdx]
      const nextRoundMIdx = Math.floor(mIdx / 2)
      const nextPos = matchPositions[rIdx + 1]?.[nextRoundMIdx]

      if (!nextPos) return

      const startX = currentPos.x + colW
      const startY = currentPos.y + MATCH_H / 2
      const endX   = nextPos.x
      const endY   = nextPos.y + MATCH_H / 2
      const midX   = startX + colGap / 2

      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.lineTo(midX, startY)
      ctx.lineTo(midX, endY)
      ctx.lineTo(endX, endY)
      
      const nextMatchPair = visRounds[rIdx + 1][nextRoundMIdx]
      const targetSlot = (mIdx % 2 === 0) ? nextMatchPair?.[0] : nextMatchPair?.[1]
      
      ctx.strokeStyle = targetSlot?.name && targetSlot?.status !== 'open' ? accent : 'rgba(255,255,255,0.2)'
      ctx.lineWidth = 2.5
      ctx.stroke()
    })
  })
  ctx.restore()

  visRounds.forEach((pairs, rIdx) => {
    const colX = PAD + rIdx * (colW + colGap)
    const isLast = rIdx === visRounds.length - 1

    pairs.forEach((pair, mIdx) => {
      const [a, b] = pair || []
      const my = matchPositions[rIdx][mIdx].y

      ctx.font = '900 12px system-ui, sans-serif'
      ctx.fillStyle = isLast ? accent : 'rgba(255,255,255,0.6)'
      ctx.textAlign = 'left'
      ctx.letterSpacing = '0.15em'
      ctx.fillText(getRoundLabel(rIdx, totalRounds), colX, my - 10)

      // Translucent Cards to let background subtly peek through
      rr(ctx, colX, my, colW, MATCH_H, 6)
      ctx.fillStyle = 'rgba(0,0,0,0.6)' 
      ctx.fill()
      ctx.strokeStyle = isLast ? accent : 'rgba(255,255,255,0.15)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(colX + 1, my + MATCH_H / 2)
      ctx.lineTo(colX + colW - 1, my + MATCH_H / 2)
      ctx.stroke()

      drawSlot(ctx, colX, my,               colW, MATCH_H / 2, a, b?.status === 'winner', accent)
      drawSlot(ctx, colX, my + MATCH_H / 2, colW, MATCH_H / 2, b, a?.status === 'winner', accent)
    })
  })

  // ── FOOTER ──
  const footerY = H - 60
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(PAD, footerY - 20); ctx.lineTo(W - PAD, footerY - 20); ctx.stroke()

  ctx.font = '800 15px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'
  ctx.fillText('WWW.NABOGAMING.LIVE', PAD, footerY + 20)
  
  ctx.textAlign = 'right'
  ctx.fillText(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase(), W - PAD, footerY + 20)

  ctx.fillStyle = accent
  ctx.fillRect(0, H - 10, W, 10)
}

export default function BracketShareModal({ open, onClose, tournament, bracketData, participants }) {
  const canvasRef               = useRef(null)
  const [ready, setReady]       = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  const gameMeta = GAME_META[tournament?.game_slug] || null

  useEffect(() => {
    if (!open || !tournament) return
    setReady(false)
    const t = setTimeout(async () => {
      if (!canvasRef.current) return
      try {
        await drawCard(canvasRef.current, { tournament, bracketData, participants: participants || [], gameMeta })
        setReady(true)
      } catch (e) { console.error('[BracketShareModal]', e) }
    }, 80)
    return () => clearTimeout(t)
  }, [open, tournament, bracketData, participants])

  if (!open) return null

  function getBlob(cb) { canvasRef.current?.toBlob(cb, 'image/png') }

  function handleDownload() {
    getBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      Object.assign(document.createElement('a'), {
        href: url,
        download: `${(tournament?.name || 'bracket').replace(/\s+/g, '-')}-card.png`,
      }).click()
      URL.revokeObjectURL(url)
      setDownloaded(true)
      setTimeout(() => setDownloaded(false), 2500)
    })
  }

  function handleShare() {
    getBlob(async blob => {
      if (!blob) return
      const file = new File([blob], 'bracket.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: tournament?.name, text: `${tournament?.name} — nabogaming.live` })
          return
        } catch (e) { if (e.name === 'AbortError') return }
      }
      handleDownload()
    })
  }

  return (
    <div
      onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.92)', display:'flex', alignItems:'center', justifyContent:'center', padding:16, backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:'#06070d', border:'1px solid #1a1d2d', borderRadius:16, padding:16, width:'100%', maxWidth:400, maxHeight:'92dvh', display:'flex', flexDirection:'column', gap:12, boxShadow:'0 48px 120px rgba(0,0,0,0.9)', overflow:'hidden' }}
      >
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <i className="ri-image-line" style={{ fontSize:16, color: gameMeta?.color || '#00ff66' }} />
            <span style={{ fontWeight:900, fontSize:14, color:'#ffffff', letterSpacing:'0.05em' }}>SHARE BRACKET POSTER</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:20, padding:4, lineHeight:1 }}>
            <i className="ri-close-line" />
          </button>
        </div>

        <div style={{ width:'100%', flex: 1, background:'#000000', border:'1px solid #1a1d2d', borderRadius:8, overflow:'hidden', position:'relative', minHeight:0 }}>
          <canvas ref={canvasRef} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block', opacity: ready ? 1 : 0, transition:'opacity 0.2s' }} />
          {!ready && (
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 }}>
              <i className="ri-loader-4-line" style={{ fontSize:26, color:'#444' }} />
              <span style={{ fontSize:12, color:'#64748b', fontWeight:700 }}>RENDERING POSTER…</span>
            </div>
          )}
        </div>

        <div style={{ display:'flex', gap:8, flexShrink:0 }}>
          <button
            onClick={handleDownload} disabled={!ready}
            style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'14px 0', background: ready ? (gameMeta?.color || '#00ff66') : '#1a1d2d', color: '#000', border:'none', borderRadius:6, fontWeight:900, fontSize:13, cursor: ready ? 'pointer' : 'not-allowed' }}
          >
            <i className={downloaded ? 'ri-checkbox-circle-fill' : 'ri-download-line'} />
            {downloaded ? 'SAVED!' : 'DOWNLOAD'}
          </button>
          <button
            onClick={handleShare} disabled={!ready}
            style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'14px 0', background:'#0b0c16', color: ready ? '#fff' : '#64748b', border:'1px solid #1a1d2d', borderRadius:6, fontWeight:800, fontSize:13, cursor: ready ? 'pointer' : 'not-allowed' }}
          >
            <i className="ri-share-line" />
            SHARE
          </button>
        </div>
      </div>
    </div>
  )
}
