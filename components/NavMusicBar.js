'use client'
import Link from 'next/link'
import { useMusicPlayer, SAMPLE_TRACKS } from './MusicPlayerContext'
import styles from './NavMusicBar.module.css'

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function NavMusicBar({ sidebar = false }) {
  const {
    currentTrack, isPlaying, currentTime, duration, isLoading,
    togglePlay, playNext, playPrev, seek,
  } = useMusicPlayer()

  const display = currentTrack || SAMPLE_TRACKS[0]
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  if (sidebar) {
    return (
      <div className={styles.sidebarBar}>
        {/* Top row: cover + info + controls */}
        <div className={styles.sidebarRow}>
          <Link href="/music" className={styles.coverLink} title="Open Music Player">
            <div className={styles.cover}>
              <img src={display.cover} alt={display.title} />
              {isPlaying && (
                <div className={styles.coverOverlay}>
                  <span /><span /><span />
                </div>
              )}
            </div>
          </Link>

          <Link href="/music" className={styles.info}>
            <span className={styles.title}>{display.title}</span>
            <span className={styles.artist}>{display.artist}</span>
          </Link>

          <div className={styles.controls}>
            <button className={styles.ctrlBtn} onClick={playPrev} title="Previous">
              <i className="ri-skip-back-mini-fill" />
            </button>
            <button
              className={`${styles.playBtn} ${isLoading ? styles.loading : ''}`}
              onClick={togglePlay}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isLoading
                ? <i className="ri-loader-4-line" />
                : isPlaying
                  ? <i className="ri-pause-fill" />
                  : <i className="ri-play-fill" />
              }
            </button>
            <button className={styles.ctrlBtn} onClick={playNext} title="Next">
              <i className="ri-skip-forward-mini-fill" />
            </button>
          </div>
        </div>

        {/* Bottom row: seek bar */}
        <div className={styles.sidebarSeekRow}>
          <span className={styles.timeLeft}>{fmtTime(currentTime)}</span>
          <div
            className={styles.progress}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              seek(((e.clientX - rect.left) / rect.width) * (duration || 0))
            }}
          >
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            <div className={styles.progressThumb} style={{ left: `${progress}%` }} />
          </div>
          <span className={styles.timeRight}>{fmtTime(duration)}</span>
        </div>
      </div>
    )
  }

  // ── Header (compact) variant ──
  return (
    <div className={styles.bar}>
      <Link href="/music" className={styles.coverLink} title="Open Music Player">
        <div className={styles.cover}>
          <img src={display.cover} alt={display.title} />
          {isPlaying && (
            <div className={styles.coverOverlay}>
              <span /><span /><span />
            </div>
          )}
        </div>
      </Link>

      <Link href="/music" className={styles.info}>
        <span className={styles.title}>{display.title}</span>
        <span className={styles.artist}>{display.artist}</span>
      </Link>

      <div className={styles.controls}>
        <button className={styles.ctrlBtn} onClick={playPrev} title="Previous">
          <i className="ri-skip-back-mini-fill" />
        </button>
        <button
          className={`${styles.playBtn} ${isLoading ? styles.loading : ''}`}
          onClick={togglePlay}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isLoading
            ? <i className="ri-loader-4-line" />
            : isPlaying
              ? <i className="ri-pause-fill" />
              : <i className="ri-play-fill" />
          }
        </button>
        <button className={styles.ctrlBtn} onClick={playNext} title="Next">
          <i className="ri-skip-forward-mini-fill" />
        </button>
      </div>

      <div className={styles.progressWrap}>
        <span className={styles.timeLeft}>{fmtTime(currentTime)}</span>
        <div
          className={styles.progress}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            seek(((e.clientX - rect.left) / rect.width) * (duration || 0))
          }}
        >
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          <div className={styles.progressThumb} style={{ left: `${progress}%` }} />
        </div>
        <span className={styles.timeRight}>{fmtTime(duration)}</span>
      </div>
    </div>
  )
}
