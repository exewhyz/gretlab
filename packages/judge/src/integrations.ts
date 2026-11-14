import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/*
 * Rules for connecting other systems to an organization: API keys, and webhooks that tell
 * them what happened. Pure functions, unit-tested; the web app stores and sends.
 */

/* ---------- API keys ---------- */

const KEY_PATTERN = /^glk_([a-z0-9]{10})_([A-Za-z0-9_-]{32,64})$/

/** A new key: shown once as `token`; kept as its `prefix` and `hash`. */
export function newApiKey() {
  const prefix = randomBytes(8).toString("hex").slice(0, 10)
  const secret = randomBytes(30).toString("base64url")
  const token = `glk_${prefix}_${secret}`
  return { token, prefix, hash: hashApiKey(token) }
}

export const hashApiKey = (token: string) =>
  createHash("sha256").update(token).digest("hex")

/** The prefix of something that looks like a key, else null. */
export function apiKeyPrefix(token: string): string | null {
  return KEY_PATTERN.exec(token)?.[1] ?? null
}

/** Whether a presented key matches a stored hash, in constant time. */
export function apiKeyMatches(token: string, hash: string) {
  const a = Buffer.from(hashApiKey(token), "hex")
  const b = Buffer.from(hash, "hex")
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ---------- webhooks ---------- */

/** Whether an event ("leave.decide") is one a webhook asked for ("leave.*", "*", or itself). */
export function eventMatches(patterns: readonly string[], event: string) {
  return patterns.some(
    (p) =>
      p === "*" ||
      p === event ||
      (p.endsWith(".*") && event.startsWith(p.slice(0, -1)))
  )
}

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`

/**
 * The signature header for a delivery: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 * A receiver recomputes it with the secret and checks the time is recent.
 */
export function signWebhook(secret: string, body: string, at: Date) {
  const t = Math.floor(at.getTime() / 1000)
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")
  return `t=${t},v1=${v1}`
}

/** Checks a signature header the way a receiver would (for tests and the docs' example). */
export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  now: Date,
  toleranceSeconds = 300
) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string])
  )
  const t = Number(parts.t)
  if (!Number.isFinite(t) || !parts.v1) return false
  if (Math.abs(now.getTime() / 1000 - t) > toleranceSeconds) return false
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")
  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(parts.v1, "hex")
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Attempts before a delivery is given up: about two days of retries. */
export const WEBHOOK_MAX_ATTEMPTS = 8

/** When to try again after `attempts` failures: 1 min, 5, 15, 1 h, 3 h, 8 h, 24 h. */
export function webhookRetryAt(attempts: number, from: Date) {
  const minutes = [1, 5, 15, 60, 180, 480, 1440][Math.min(attempts - 1, 6)] ?? 1440
  return new Date(from.getTime() + minutes * 60_000)
}

/**
 * Whether an address may receive webhooks: https, and (unless allowed for local testing)
 * not a name or literal address on this machine or a private network.
 */
export function webhookUrlProblem(raw: string, allowLocal = false): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return "That isn't a web address."
  }
  if (url.username || url.password) return "Leave the user name and password out of the address."
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  const local =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    isPrivateAddress(host)
  if (allowLocal && local) return url.protocol === "http:" || url.protocol === "https:" ? null : "Use an http or https address."
  if (url.protocol !== "https:") return "Use an https address."
  if (local) return "Use a public address, not one on this machine or a private network."
  return null
}

/** A literal IP address in a private, loopback or link-local range. */
export function isPrivateAddress(host: string) {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  if (host.includes(":")) {
    const h = host.toLowerCase()
    return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:")
  }
  return false
}
