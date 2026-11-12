/*
 * Rules for the Hostel module (apps/web/features/hostel): naming beds, adding rooms in a
 * run, and what can be removed. Pure, so they're unit-tested here.
 */

/** Beds in a room are lettered A, B, C... (then AA, AB... past Z). */
export function bedLabel(index: number): string {
  let n = index
  let label = ""
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

export const bedLabels = (count: number) => Array.from({ length: count }, (_, i) => bedLabel(i))

/**
 * Room names for a run, e.g. prefix "A-", 101 to 105: A-101 ... A-105. At most 200 at a
 * time; null when the run is backwards or too long.
 */
export function roomRun(prefix: string, from: number, to: number): string[] | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to - from >= 200) {
    return null
  }
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`)
}

/**
 * Changing a room's number of beds: beds are added or removed from the end (the last
 * letters). Returns the labels to remove, or null when one of them is occupied.
 */
export function bedsToRemove(
  current: string[],
  wanted: number,
  occupied: ReadonlySet<string>
): string[] | null {
  const extra = current.slice(wanted)
  return extra.some((b) => occupied.has(b)) ? null : extra
}
