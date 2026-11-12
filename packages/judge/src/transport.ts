import { isTime, minutesOf } from "./timetable.ts"

/*
 * Rules for the Transport module (apps/web/features/transport): a route's stops and their
 * times, and seats on the vehicle. Pure, so they're unit-tested here.
 */

export interface StopInput {
  name: string
  /** Morning pick-up, "HH:MM", or "" when not set. */
  pickup: string
  /** Afternoon drop-off, "HH:MM", or "". */
  drop: string
}

/**
 * Why a route's stops (in order, first pick-up first) can't be saved, or null. Names are
 * needed and distinct; times are optional, but pick-ups set along the route must not go
 * back in time, and drop-offs run the other way (the last stop picked up is dropped first).
 */
export function stopsProblem(stops: StopInput[]): string | null {
  const seen = new Set<string>()
  for (const [i, s] of stops.entries()) {
    const name = s.name.trim().toLowerCase()
    if (!name) return `Stop ${i + 1} needs a name.`
    if (seen.has(name)) return `"${s.name.trim()}" is listed twice.`
    seen.add(name)
    for (const t of [s.pickup, s.drop]) {
      if (t && !isTime(t)) return `${s.name.trim()}: give times like 07:30.`
    }
  }
  const inOrder = (times: string[]) => {
    const set = times.filter(Boolean).map(minutesOf)
    return set.every((m, i) => i === 0 || m >= set[i - 1]!)
  }
  if (!inOrder(stops.map((s) => s.pickup))) {
    return "Pick-up times must run in the order of the stops."
  }
  if (!inOrder(stops.map((s) => s.drop).reverse())) {
    return "Drop-off times must run from the last stop back to the first."
  }
  return null
}

/** Seats left on a route; no capacity means no limit. */
export const seatsLeft = (capacity: number | null, riders: number) =>
  capacity == null ? Number.POSITIVE_INFINITY : Math.max(0, capacity - riders)
