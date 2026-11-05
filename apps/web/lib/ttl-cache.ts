interface Entry<T> {
  expires: number
  value: Promise<T>
}

const entries = new Map<string, Entry<unknown>>()

/**
 * A short-lived cache local to this server process, for data read on nearly every request.
 * Concurrent callers share one computation, so a stampede costs a single query.
 *
 * With several web replicas, each caches separately: a change made on one is seen on the
 * others within the TTL. Keep TTLs to seconds, and use it only where that's acceptable.
 */
export function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  const hit = entries.get(key) as Entry<T> | undefined
  if (hit && hit.expires > Date.now()) return hit.value
  const value = compute()
  entries.set(key, { expires: Date.now() + ttlMs, value })
  // A failure shouldn't be remembered.
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key)
  })
  return value
}

export function invalidate(key: string) {
  entries.delete(key)
}
