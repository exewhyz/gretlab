/*
 * Lab exams: an assignment taken in one sitting. Pure rules, no I/O: who may start from
 * where, when a sitting ends, and which submissions count.
 */

export interface ExamSettings {
  /** Each student's time from pressing Start; null means until the due time. */
  minutes: number | null
  /** Ask for fullscreen and record leaving it. */
  fullscreen: boolean
  /** Addresses allowed to start and submit ("10.1.0.0/16", "2001:db8::/48"); empty allows any. */
  networks: string[]
  /**
   * Minutes after opening during which Start may be pressed; null for any time before the
   * due time. Keeps a lab starting together, so early finishers can't brief late starters.
   */
  startWithin?: number | null
}

/** What a sitting's record can hold. */
export const EXAM_EVENTS = [
  "left_tab",
  "left_fullscreen",
  "pasted",
  "other_network",
] as const
export type ExamEventKind = (typeof EXAM_EVENTS)[number]

/** What a student's browser may report; the server records the rest itself. */
export const BROWSER_EXAM_EVENTS = ["left_tab", "left_fullscreen", "pasted"] as const

function ipv4(text: string): bigint | null {
  const parts = text.split(".")
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null
    value = value * 256n + BigInt(part)
  }
  return value
}

/** An IPv6 address as a 128-bit number, "::" and an embedded IPv4 tail allowed. */
function ipv6(text: string): bigint | null {
  if (!text.includes(":") || !/^[0-9a-f:.]+$/i.test(text)) return null
  let head = text
  const tail: number[] = []
  const v4 = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const value = ipv4(v4[2]!)
    if (value === null) return null
    head = v4[1]!.endsWith("::") ? v4[1]! : v4[1]!.slice(0, -1)
    tail.push(Number(value >> 16n), Number(value & 0xffffn))
  }
  const halves = head.split("::")
  if (halves.length > 2) return null
  const groups = (part: string) => (part === "" ? [] : part.split(":"))
  const left = groups(halves[0]!)
  const right = halves.length === 2 ? groups(halves[1]!) : []
  const missing = 8 - tail.length - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const all = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right]
  let value = 0n
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  for (const word of tail) value = (value << 16n) | BigInt(word)
  return value
}

/** An address as (family bits, value); "::ffff:10.0.0.1" counts as the IPv4 address. */
function parseIp(text: string): { bits: 32 | 128; value: bigint } | null {
  const trimmed = text.trim().toLowerCase()
  const four = ipv4(trimmed)
  if (four !== null) return { bits: 32, value: four }
  const six = ipv6(trimmed)
  if (six === null) return null
  if (six >> 32n === 0xffffn) return { bits: 32, value: six & 0xffffffffn }
  return { bits: 128, value: six }
}

function parseNetwork(entry: string) {
  const [address, prefix, extra] = entry.trim().split("/")
  if (extra !== undefined || !address) return null
  const ip = parseIp(address)
  if (!ip) return null
  if (prefix === undefined) return { ...ip, prefix: ip.bits }
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > ip.bits) return null
  return { ...ip, prefix: Number(prefix) }
}

/** A valid network entry: an IPv4 or IPv6 address, or a range in CIDR form. */
export const isNetwork = (entry: string) => parseNetwork(entry) !== null

/** Whether an address is inside any of the networks. No networks allows everyone. */
export function ipAllowed(ip: string | null, networks: readonly string[]) {
  if (networks.length === 0) return true
  const address = ip ? parseIp(ip) : null
  if (!address) return false
  return networks.some((entry) => {
    const net = parseNetwork(entry)
    if (!net || net.bits !== address.bits) return false
    const shift = BigInt(net.bits - net.prefix)
    return address.value >> shift === net.value >> shift
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

/**
 * A submission pressed in the last moment is stamped when the server stores it, a little
 * after the click. This much after the close still counts.
 */
export const SUBMIT_GRACE_MS = 10_000

/** Submissions made during the sitting; without one, none count. */
export function duringSitting<T extends { createdAt: Date }>(
  attempts: readonly T[],
  sitting: ExamSitting | null | undefined
): T[] {
  if (!sitting) return []
  const closes = sittingClosesAt(sitting).getTime() + SUBMIT_GRACE_MS
  return attempts.filter(
    (a) => a.createdAt >= sitting.startedAt && a.createdAt.getTime() <= closes
  )
}
