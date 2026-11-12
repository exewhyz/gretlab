import { createHash, createHmac, randomBytes, randomInt } from "node:crypto"

/*
 * Two-factor sign-in with an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 30-second steps,
 * 6 digits) and one-time backup codes. Server-only (node:crypto), so it's its own entry
 * point, `@workspace/judge/totp`, kept out of the package index that pages import.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(bytes: Uint8Array) {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "")
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) throw new Error("Not base32")
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new secret: 20 random bytes, base32, as authenticator apps expect. */
export const newTotpSecret = () => base32Encode(randomBytes(20))

/** The code for one counter (RFC 4226). */
export function hotp(secret: Uint8Array, counter: number, digits = 6) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const hash = createHmac("sha1", secret).update(message).digest()
  const offset = hash[hash.length - 1]! & 15
  const binary = (hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits
  return String(binary).padStart(digits, "0")
}

export const TOTP_STEP_SECONDS = 30

export const stepAt = (unixSeconds: number) => Math.floor(unixSeconds / TOTP_STEP_SECONDS)

/** The code shown at a moment, for a base32 secret. */
export const totpAt = (secret: string, unixSeconds: number, digits = 6) =>
  hotp(base32Decode(secret), stepAt(unixSeconds), digits)

/**
 * Checks a 6-digit code, allowing one step either side for clock drift. Returns the step
 * it matched, or null. A step at or before `lastStep` (the last one accepted) is refused,
 * so a code can't be used twice.
 */
export function verifyTotp(
  secret: string,
  code: string,
  unixSeconds: number,
  lastStep: number | null
): number | null {
  const digits = code.replace(/\s/g, "")
  if (!/^\d{6}$/.test(digits)) return null
  const key = base32Decode(secret)
  const now = stepAt(unixSeconds)
  for (const step of [now, now - 1, now + 1]) {
    if (lastStep != null && step <= lastStep) continue
    if (hotp(key, step) === digits) return step
  }
  return null
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUrl(input: { secret: string; account: string; issuer: string }) {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`)
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params}`
}

// No 0/o, 1/l/i: backup codes are read off paper.
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"

/** Ten one-time codes like "k7m2-9qxp". */
export function newBackupCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 8 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("")
    return `${chars.slice(0, 4)}-${chars.slice(4)}`
  })
}

/** A backup code as typed (any case, spaces or dashes), ready to hash. */
export const normalizeBackupCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, "")

/** How backup codes are stored: never the code itself. */
export const hashBackupCode = (code: string) =>
  createHash("sha256").update(normalizeBackupCode(code)).digest("hex")

/* ---------- codes by email ---------- */

/** An emailed code lasts 10 minutes, allows 5 tries, and is sent at most once a minute, 5 an hour. */
export const EMAIL_CODE = {
  ttlMs: 10 * 60_000,
  attempts: 5,
  resendMs: 60_000,
  perHour: 5,
} as const

/** A 6-digit code from a secure random source. */
export const newEmailCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0")

/** How an emailed code is stored: tied to the person, never the code itself. */
export const hashEmailCode = (userId: string, code: string) =>
  createHash("sha256").update(`${userId}:${code.replace(/\s/g, "")}`).digest("hex")

/**
 * Whether another code may be emailed now, given when the last went and how many went
 * in the current hour. Returns the seconds to wait, or 0.
 */
export function emailWait(
  state: { sentAt: Date | null; sends: number; windowStart: Date | null },
  now: Date
): number {
  if (state.sentAt && now.getTime() - state.sentAt.getTime() < EMAIL_CODE.resendMs) {
    return Math.ceil((EMAIL_CODE.resendMs - (now.getTime() - state.sentAt.getTime())) / 1000)
  }
  const inWindow = state.windowStart && now.getTime() - state.windowStart.getTime() < 3_600_000
  if (inWindow && state.sends >= EMAIL_CODE.perHour) {
    return Math.ceil((3_600_000 - (now.getTime() - state.windowStart!.getTime())) / 1000)
  }
  return 0
}

/** "a•••a@gmail.com": enough to recognise, not to read. */
export function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@")
  const shown = name.length <= 2 ? name[0] ?? "" : `${name[0]}•••${name[name.length - 1]}`
  return `${shown}@${domain}`
}
