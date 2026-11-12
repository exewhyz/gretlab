import assert from "node:assert/strict"
import { test } from "node:test"

import {
  base32Decode,
  base32Encode,
  hashBackupCode,
  hotp,
  newBackupCodes,
  newTotpSecret,
  normalizeBackupCode,
  otpauthUrl,
  totpAt,
  verifyTotp,
} from "./totp.ts"

// RFC 6238 appendix B: the SHA-1 secret is the ASCII "12345678901234567890".
const RFC = base32Encode(Buffer.from("12345678901234567890"))

test("RFC 6238 test values (8 digits)", () => {
  const cases: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ]
  for (const [t, code] of cases) assert.equal(totpAt(RFC, t, 8), code, String(t))
})

test("RFC 4226 HOTP values", () => {
  const key = Buffer.from("12345678901234567890")
  assert.deepEqual(
    [0, 1, 2, 9].map((c) => hotp(key, c)),
    ["755224", "287082", "359152", "520489"]
  )
})

test("base32 round-trips, and new secrets are 32 characters", () => {
  const bytes = Buffer.from([0, 1, 2, 250, 255, 128])
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes)
  assert.match(newTotpSecret(), /^[A-Z2-7]{32}$/)
})

test("a code is accepted now and one step either side, not further", () => {
  const secret = newTotpSecret()
  const t = 1_800_000_000
  assert.equal(verifyTotp(secret, totpAt(secret, t), t, null), Math.floor(t / 30))
  assert.ok(verifyTotp(secret, totpAt(secret, t - 30), t, null))
  assert.ok(verifyTotp(secret, totpAt(secret, t + 30), t, null))
  assert.equal(verifyTotp(secret, totpAt(secret, t - 90), t, null), null)
  assert.equal(verifyTotp(secret, "12345", t, null), null)
  assert.equal(verifyTotp(secret, "abcdef", t, null), null)
})

test("a code can't be used twice", () => {
  const secret = newTotpSecret()
  const t = 1_800_000_000
  const step = verifyTotp(secret, totpAt(secret, t), t, null)
  assert.equal(verifyTotp(secret, totpAt(secret, t), t, step), null)
  assert.ok(verifyTotp(secret, totpAt(secret, t + 30), t + 30, step))
})

test("the app link carries the secret and who it's for", () => {
  const url = otpauthUrl({ secret: "ABC", account: "a@b.c", issuer: "Gretlab" })
  assert.ok(url.startsWith("otpauth://totp/Gretlab%3Aa%40b.c?"))
  assert.ok(url.includes("secret=ABC") && url.includes("issuer=Gretlab"))
})

test("backup codes: ten, readable, typed any way, hashed", () => {
  const codes = newBackupCodes()
  assert.equal(codes.length, 10)
  assert.equal(new Set(codes).size, 10)
  for (const c of codes) assert.match(c, /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/)
  assert.equal(normalizeBackupCode(" K7M2 9QXP "), "k7m29qxp")
  assert.equal(hashBackupCode("K7M2-9QXP"), hashBackupCode("k7m29qxp"))
})

test("emailed codes: six digits, hashed per person", async () => {
  const { newEmailCode, hashEmailCode } = await import("./totp.ts")
  assert.match(newEmailCode(), /^\d{6}$/)
  assert.notEqual(hashEmailCode("a", "123456"), hashEmailCode("b", "123456"))
  assert.equal(hashEmailCode("a", "123 456"), hashEmailCode("a", "123456"))
})

test("emailing again waits a minute, and at most five an hour", async () => {
  const { emailWait } = await import("./totp.ts")
  const now = new Date("2026-11-12T10:00:00Z")
  const ago = (s: number) => new Date(now.getTime() - s * 1000)
  assert.equal(emailWait({ sentAt: null, sends: 0, windowStart: null }, now), 0)
  assert.equal(emailWait({ sentAt: ago(20), sends: 1, windowStart: ago(20) }, now), 40)
  assert.equal(emailWait({ sentAt: ago(90), sends: 2, windowStart: ago(900) }, now), 0)
  assert.equal(emailWait({ sentAt: ago(90), sends: 5, windowStart: ago(900) }, now), 2700)
  assert.equal(emailWait({ sentAt: ago(90), sends: 5, windowStart: ago(4000) }, now), 0)
})

test("addresses are masked", async () => {
  const { maskEmail } = await import("./totp.ts")
  assert.equal(maskEmail("asha.k@gmail.com"), "a•••k@gmail.com")
  assert.equal(maskEmail("ab@x.in"), "a@x.in")
})
