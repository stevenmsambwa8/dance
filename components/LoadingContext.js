'use client'
import { createContext, useContext, useState, useCallback } from 'react'

const LoadingContext = createContext({ loading: false, setPageLoading: () => {} })
export const useLoadingContext = () => useContext(LoadingContext)

export default function LoadingProvider({ children }) {
  const [loading, setLoading] = useState(false)
  const setPageLoading = useCallback((val) => setLoading(val), [])
  return (
    <LoadingContext.Provider value={{ loading, setPageLoading }}>
      {children}
    </LoadingContext.Provider>
  )
}
