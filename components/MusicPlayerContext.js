'use client'
import { createContext, useContext, useRef, useState, useCallback } from 'react'

export const SAMPLE_TRACKS = [
  {
    id: 1,
    title: 'Epic Battle Arena',
    artist: 'SoundRider',
    duration: 185,
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    genre: 'Epic',
  },
  {
    id: 2,
    title: 'Cyber Tournament',
    artist: 'NeoWave',
    duration: 210,
    cover: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=300&h=300&fit=crop',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    genre: 'Electronic',
  },
  {
    id: 3,
    title: 'Victory March',
    artist: 'EliteBeats',
    duration: 195,
    cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    genre: 'Orchestral',
  },
  {
    id: 4,
    title: 'Dark Warrior',
    artist: 'BassDrop',
    duration: 220,
    cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    genre: 'Trap',
  },
  {
    id: 5,
    title: "Champion's Rise",
    artist: 'AudioForge',
    duration: 200,
    cover: 'https://images.unsplash.com/photo-1571330735066-03aaa9429d89?w=300&h=300&fit=crop',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    genre: 'Hip-Hop',
  },
  {
    id: 6,
    title: 'Neon Rush',
    artist: 'SynthMaster',
    duration: 175,
    cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&h=300&fit=crop',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
    genre: 'Synthwave',
  },
  {
    id: 7,
    title: 'Final Round',
    artist: 'DrumKingz',
    duration: 240,
    cover: 'https://images.unsplash.com/photo-1504898770365-14faca6a7320?w=300&h=300&fit=crop',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
    genre: 'Drum & Bass',
  },
  {
    id: 8,
    title: 'Tournament Anthem',
    artist: 'GrandScore',
    duration: 190,
    cover: 'https://images.unsplash.com/photo-1501612780327-45045538702b?w=300&h=300&fit=crop',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    genre: 'Cinematic',
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
    if (!currentTrack) { playTrack(SAMPLE_TRACKS[0]); return }
    const idx = SAMPLE_TRACKS.findIndex(t => t.id === currentTrack.id)
    playTrack(SAMPLE_TRACKS[(idx + 1) % SAMPLE_TRACKS.length])
  }, [currentTrack, playTrack])

  const playPrev = useCallback(() => {
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return }
    if (!currentTrack) return
    const idx = SAMPLE_TRACKS.findIndex(t => t.id === currentTrack.id)
    playTrack(SAMPLE_TRACKS[(idx - 1 + SAMPLE_TRACKS.length) % SAMPLE_TRACKS.length])
  }, [currentTrack, playTrack])

  const seek = useCallback((time) => {
    if (audioRef.current) { audioRef.current.currentTime = time; setCurrentTime(time) }
  }, [])

  const changeVolume = useCallback((v) => {
    if (audioRef.current) audioRef.current.volume = v
    setVolumeState(v)
  }, [])

  return (
    <MusicContext.Provider value={{
      currentTrack, isPlaying, volume, currentTime, duration, isLoading,
      playTrack, togglePlay, playNext, playPrev, seek, changeVolume,
    }}>
      <audio
        ref={audioRef}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={playNext}
        onWaiting={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
      />
      {children}
    </MusicContext.Provider>
  )
}

export const useMusicPlayer = () => useContext(MusicContext)
