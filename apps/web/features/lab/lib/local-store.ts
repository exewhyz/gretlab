import { useSyncExternalStore } from "react"

export interface LocalStore<T> {
  get: () => T
  /** Updates memory and subscribers. Call `persist` to write to localStorage. */
  update: (updater: (previous: T) => T) => void
  persist: () => void
  clear: () => void
  subscribe: (listener: () => void) => () => void
  serverValue: T
}

/**
 * A small external store backed by localStorage. It reads lazily on the client and
 * reports `initial` during SSR, so `useLocalStore` hydrates without a mismatch.
 * Storage can be unavailable (private windows, blocked site data), in which case
 * it quietly stays in memory.
 */
export function createLocalStore<T>(
  key: string,
  initial: T,
  parse: (raw: unknown) => T
): LocalStore<T> {
  let state = initial
  let loaded = false
  const listeners = new Set<() => void>()

  function load() {
    if (loaded || typeof window === "undefined") return
    loaded = true
    try {
      const raw = window.localStorage.getItem(key)
      if (raw) state = parse(JSON.parse(raw))
    } catch {
      state = initial
    }
  }

  function emit() {
    listeners.forEach((listener) => listener())
  }

  return {
    serverValue: initial,
    get() {
      load()
      return state
    },
    update(updater) {
      load()
      state = updater(state)
      emit()
    },
    persist() {
      try {
        window.localStorage.setItem(key, JSON.stringify(state))
      } catch {
        // Storage is full or blocked; the value stays in memory for this visit.
      }
    },
    clear() {
      state = initial
      loaded = true
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Nothing to remove if storage is blocked.
      }
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** `select` must return a stable reference for an unchanged store value. */
export function useLocalStore<T, S>(
  store: LocalStore<T>,
  select: (value: T) => S
): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.serverValue)
  )
}
