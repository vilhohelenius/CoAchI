import { useCallback, useEffect, useState } from 'preact/hooks'

export type Load<T> = { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ok'; data: T }

/** One GET, with a retry counter. Behind Access an expired session answers 401. */
export function useApi<T>(url: string): [Load<T>, () => void] {
  const [st, set] = useState<Load<T>>({ s: 'loading' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const ac = new AbortController()
    set({ s: 'loading' })
    fetch(url, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Your session expired. Reload the page to sign in again.' : `The server answered ${r.status}.`)
        set({ s: 'ok', data: (await r.json()) as T })
      })
      .catch((e: Error) => { if (e.name !== 'AbortError') set({ s: 'error', msg: e.message === 'Failed to fetch' ? 'The server did not answer.' : e.message }) })
    return () => ac.abort()
  }, [url, tick])
  return [st, useCallback(() => setTick((t) => t + 1), [])]
}
