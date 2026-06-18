'use client'
import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'

export const SAMPLE_TRACKS = [
  {
    id: 1,
    title: 'Timeless',
    artist: 'Mr. Fantastic',
    duration: 0,
    cover: '/timeless.png',
    url: '/timeless.mp3',
    genre: 'Gaming',
  },
]

const MusicContext = createContext(null)

export default function MusicPlayerProvider({ children }) {
  const audioRef = useRef(null)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolumeState] = useState(0.8)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  const playTrack = useCallback((track) => {
    const audio = audioRef.current
    if (!audio) return
    if (currentTrack?.id === track.id) {
      if (isPlaying) { audio.pause(); setIsPlaying(false) }
      else { audio.play().then(() => setIsPlaying(true)).catch(() => {}) }
      return
    }
    setIsLoading(true)
    audio.src = track.url
    audio.volume = volume
    setCurrentTrack(track)
    setCurrentTime(0)
    audio.play()
      .then(() => { setIsPlaying(true); setIsLoading(false) })
      .catch(() => setIsLoading(false))
  }, [currentTrack, isPlaying, volume])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    if (isPlaying) { audio.pause(); setIsPlaying(false) }
    else { audio.play().then(() => setIsPlaying(true)).catch(() => {}) }
  }, [isPlaying, currentTrack])

  const playNext = useCallback(() => {
    playTrack(SAMPLE_TRACKS[0])
  }, [playTrack])

  const playPrev = useCallback(() => {
    const audio = audioRef.current
    if (audio) { audio.currentTime = 0; setCurrentTime(0) }
  }, [])

  const seek = useCallback((time) => {
    if (audioRef.current) { audioRef.current.currentTime = time; setCurrentTime(time) }
  }, [])

  const changeVolume = useCallback((v) => {
    if (audioRef.current) audioRef.current.volume = v
    setVolumeState(v)
  }, [])

  // Autoplay on mount — browsers require a user gesture first,
  // so we attempt silently and let the player UI handle the blocked case.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const track = SAMPLE_TRACKS[0]
    audio.src = track.url
    audio.volume = volume
    setCurrentTrack(track)
    setIsLoading(true)
    audio.play()
      .then(() => { setIsPlaying(true); setIsLoading(false) })
      .catch(() => setIsLoading(false)) // Blocked by browser autoplay policy — user tap will start it
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MusicContext.Provider value={{
      currentTrack, isPlaying, volume, currentTime, duration, isLoading,
      playTrack, togglePlay, playNext, playPrev, seek, changeVolume,
    }}>
      <audio
        ref={audioRef}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0) }}
        onWaiting={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
      />
      {children}
    </MusicContext.Provider>
  )
}

export const useMusicPlayer = () => useContext(MusicContext)
