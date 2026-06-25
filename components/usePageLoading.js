'use client'
import { useEffect } from 'react'
import { useLoadingContext } from './LoadingContext'

export default function usePageLoading(isLoading) {
  const { setPageLoading } = useLoadingContext()

  // NOTE: state updates must only happen in an effect, never during render.
  // Calling setPageLoading() directly in the function body (as before) ran
  // it during this component's render phase, which could interleave with
  // the unmounting previous page's cleanup in an unpredictable order and
  // leave `loading` stuck true with nothing left to flip it back.
  useEffect(() => {
    setPageLoading(!!isLoading)
    return () => setPageLoading(false)
  }, [isLoading, setPageLoading])
}
