import { useCallback, useEffect, useState } from 'react'

/** Fetch-on-mount with loading/error state and a retry callback. */
export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(() => {
    setError(null)
    load()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(run, [run])
  return { data, error, reload: run }
}

