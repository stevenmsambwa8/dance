'use client'
import { useEffect } from 'react'
import { useLoadingContext } from './LoadingContext'

export default function usePageLoading(isLoading) {
  const { setPageLoading } = useLoadingContext()

  // Set synchronously during render so overlay shows before first paint
  setPageLoading(!!isLoading)

  useEffect(() => {
    // Keep in sync after mount too
    setPageLoading(!!isLoading)
    return () => setPageLoading(false)
  }, [isLoading, setPageLoading])
}
