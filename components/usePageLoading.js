'use client'
import { useEffect } from 'react'
import { useLoadingContext } from './LoadingContext'

export default function usePageLoading(isLoading) {
  const { setPageLoading } = useLoadingContext()

  setPageLoading(!!isLoading)

  useEffect(() => {
    setPageLoading(!!isLoading)
    return () => setPageLoading(false)
  }, [isLoading, setPageLoading])
}
