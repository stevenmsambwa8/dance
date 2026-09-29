// Tiny in-memory stale-while-revalidate cache shared across page navigations.
// Pages read it for their FIRST render (so revisits show instantly) and then
// refetch in the background and write fresh data back.
const store = new Map()

export const getCached = (key) => store.get(key)
export const setCached = (key, value) => { store.set(key, value) }
export const clearCached = (prefix) => {
  if (!prefix) return store.clear()
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
}
