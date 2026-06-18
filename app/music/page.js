'use client'
import { useState } from 'react'
import { useMusicPlayer, SAMPLE_TRACKS } from '../../components/MusicPlayerContext'
import styles from './page.module.css'

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function MusicPage() {
  const {
    currentTrack, isPlaying, volume, currentTime, duration, isLoading,
    playTrack, togglePlay, playNext, playPrev, seek, changeVolume,
  } = useMusicPlayer()

  const [activeGenre, setActiveGenre] = useState('All')

  const display = currentTrack || SAMPLE_TRACKS[0]
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const genres = ['All', ...Array.from(new Set(SAMPLE_TRACKS.map(t => t.genre)))]
  const filtered = activeGenre === 'All'
    ? SAMPLE_TRACKS
    : SAMPLE_TRACKS.filter(t => t.genre === activeGenre)

  // FIX: on first load currentTrack is null, so clicking a track row
  // always triggers a fresh load. But if context initialises currentTrack
  // to SAMPLE_TRACKS[0] without playing, we need to force-play here.
  function handleTrackClick(track) {
    if (currentTrack?.id === track.id && !isPlaying) {
      // Same track already loaded but not playing — just resume
      togglePlay()
    } else {
      playTrack(track)
    }
  }

  return (
    <div className={styles.page}>

      {/* ── Hero Player ── */}
      <div className={styles.hero}>
        <div className={styles.heroBg} style={{ backgroundImage: `url(${display.cover})` }} />
        <div className={styles.heroOverlay} />

        <div className={styles.heroContent}>
          <div className={`${styles.albumArt} ${isPlaying ? styles.albumGlow : ''}`}>
            <img src={display.cover} alt={display.title} />
          </div>

          <div className={styles.trackInfo}>
            <span className={styles.genreBadge}>{display.genre}</span>
            <h1 className={styles.trackTitle}>{display.title}</h1>
            <p className={styles.trackArtist}>{display.artist}</p>
          </div>

          <div className={styles.seekWrap}>
            <span className={styles.seekTime}>{fmtTime(currentTime)}</span>
            <div
              className={styles.seekBar}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                seek(((e.clientX - rect.left) / rect.width) * (duration || 0))
              }}
            >
              <div className={styles.seekFill} style={{ width: `${progress}%` }} />
              <div className={styles.seekThumb} style={{ left: `${progress}%` }} />
            </div>
            <span className={styles.seekTime}>{fmtTime(duration)}</span>
          </div>

          <div className={styles.playerControls}>
            <button className={styles.ctrlBtn} onClick={playPrev}>
              <i className="ri-skip-back-fill" />
            </button>
            <button
              className={`${styles.playBtnLarge} ${isLoading ? styles.loadingBtn : ''}`}
              onClick={togglePlay}
            >
              {isLoading
                ? <i className="ri-loader-4-line" />
                : isPlaying
                  ? <i className="ri-pause-fill" />
                  : <i className="ri-play-fill" />
              }
            </button>
            <button className={styles.ctrlBtn} onClick={playNext}>
              <i className="ri-skip-forward-fill" />
            </button>
          </div>

          {/* FIX: pass --vol so the CSS gradient fill tracks the thumb */}
          <div className={styles.volumeWrap}>
            <i className={volume === 0 ? 'ri-volume-mute-line' : 'ri-volume-down-line'} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={e => changeVolume(parseFloat(e.target.value))}
              className={styles.volumeSlider}
              style={{ '--vol': `${Math.round(volume * 100)}%` }}
            />
            <i className="ri-volume-up-line" />
          </div>
        </div>
      </div>

      {/* ── Track List ── */}
      <div className={styles.listSection}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>
            <i className="ri-music-2-line" /> Library
          </h2>
          <div className={styles.genreFilters}>
            {genres.map(g => (
              <button
                key={g}
                className={`${styles.genreBtn} ${activeGenre === g ? styles.genreBtnActive : ''}`}
                onClick={() => setActiveGenre(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.trackList}>
          {filtered.map((track, idx) => {
            const isActive = currentTrack?.id === track.id
            const isThisPlaying = isActive && isPlaying
            return (
              <button
                key={track.id}
                className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ''}`}
                onClick={() => handleTrackClick(track)}
              >
                <div className={styles.trackIdx}>
                  {isThisPlaying
                    ? <span className={styles.eqBars}><span /><span /><span /></span>
                    : <span className={styles.idxNum}>{idx + 1}</span>
                  }
                </div>
                <div className={styles.trackCover}>
                  <img src={track.cover} alt={track.title} />
                </div>
                <div className={styles.trackMeta}>
                  <span className={styles.trackName}>{track.title}</span>
                  <span className={styles.trackSub}>{track.artist} · {track.genre}</span>
                </div>
                <span className={styles.trackDuration}>{fmtTime(track.duration)}</span>
                <div className={styles.trackPlay}>
                  <i className={isThisPlaying ? 'ri-pause-fill' : 'ri-play-fill'} />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
