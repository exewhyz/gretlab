/*
 * Lab exams: an assignment taken in one sitting. Pure rules, no I/O: who may start from
 * where, when a sitting ends, and which submissions count.
 */

export interface ExamSettings {
  /** Each student's time from pressing Start; null means until the due time. */
  minutes: number | null
  /** Ask for fullscreen and record leaving it. */
  fullscreen: boolean
  /** Addresses allowed to start and submit ("10.1.0.0/16", "203.0.113.7"); empty allows any. */
  networks: string[]
}

/** What the browser reports during a sitting. */
export const EXAM_EVENTS = [
  "left_tab",
  "left_fullscreen",
  "pasted",
  "other_network",
] as const
export type ExamEventKind = (typeof EXAM_EVENTS)[number]

function ipv4(text: string): number | null {
  const parts = text.split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value
}

/** "::ffff:10.0.0.1" is IPv4 seen through IPv6. */
const unmapped = (ip: string) => ip.trim().replace(/^::ffff:/i, "").toLowerCase()

/** A valid network entry: an IPv4 address or CIDR range, or an exact IPv6 address. */
export function isNetwork(entry: string): boolean {
  const [address, bits, extra] = entry.trim().split("/")
  if (extra !== undefined || !address) return false
  if (ipv4(address) !== null) {
    return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32)
  }
  return bits === undefined && /^[0-9a-f:]+$/i.test(address) && address.includes(":")
}

/** Whether an address is inside any of the networks. No networks allows everyone. */
export function ipAllowed(ip: string | null, networks: readonly string[]) {
  if (networks.length === 0) return true
  if (!ip) return false
  const address = unmapped(ip)
  const value = ipv4(address)
  return networks.some((entry) => {
    const [net, bits] = entry.trim().toLowerCase().split("/")
    if (value === null) return net === address
    const base = ipv4(net!)
    if (base === null) return false
    const size = bits === undefined ? 32 : Number(bits)
    const block = 2 ** (32 - size)
    return Math.floor(value / block) === Math.floor(base / block)
  })
}

/** When a sitting started now ends: its time limit or the due time, whichever is first. */
export function examEndsAt(
  startedAt: Date,
  dueAt: Date,
  minutes: number | null
): Date {
  if (minutes === null) return dueAt
  const limit = new Date(startedAt.getTime() + minutes * 60_000)
  return limit < dueAt ? limit : dueAt
}

export interface ExamSitting {
  startedAt: Date
  endsAt: Date
  finishedAt: Date | null
}

/** The moment a sitting stopped accepting work. */
export const sittingClosesAt = (s: ExamSitting) =>
  s.finishedAt && s.finishedAt < s.endsAt ? s.finishedAt : s.endsAt

/** Submissions made during the sitting; without one, none count. */
export function duringSitting<T extends { createdAt: Date }>(
  attempts: readonly T[],
  sitting: ExamSitting | null | undefined
): T[] {
  if (!sitting) return []
  const closes = sittingClosesAt(sitting)
  return attempts.filter(
    (a) => a.createdAt >= sitting.startedAt && a.createdAt <= closes
  )
}
