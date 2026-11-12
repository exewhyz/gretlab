import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import {
  getDb,
  orgRoles,
  roleAssignments,
  sql,
  twoFactor,
  users,
  type User,
} from "@workspace/db"
import {
  EMAIL_CODE,
  emailWait,
  hashBackupCode,
  hashEmailCode,
  maskEmail,
  newBackupCodes,
  newEmailCode,
  newTotpSecret,
  otpauthUrl,
  verifyTotp,
} from "@workspace/judge/totp"
import { after } from "next/server"
import QRCode from "qrcode"

import { writeEntry } from "@/features/audit/server"
import { mailEnabled } from "@/features/notifications/mailer"
import { queueEmails, sendUrgent } from "@/features/notifications/outbox"
import { rolePermissions } from "@/features/orgs/access"
import { platformAccess } from "@/features/platform/access"
import { getSettings } from "@/features/settings/server"
import { ApiError } from "@/lib/api/errors"

/*
 * Two-factor sign-in, after Google. Methods: an authenticator app (TOTP, RFC 6238), codes
 * by email, or both; plus ten one-time backup codes. Rules and code generation in
 * packages/judge/src/totp.ts.
 *
 * The session cookie is a JWT. A code is checked in NextAuth's jwt callback
 * (features/auth/options.ts → verifySecondStep / confirmApp / confirmEmail here), and only
 * a right one writes `mfaAt` into the signed cookie. Someone with two-factor on counts as
 * signed in only while `mfaAt` is at or after `enabled_at` (features/auth/current-user.ts),
 * or while their browser holds a valid 30-day trust cookie (trustCookie below).
 *
 * At rest: the app secret is sealed (AES-256-GCM, key derived from NEXTAUTH_SECRET:
 * changing that means setting the app up again); backup and emailed codes are hashed;
 * `last_step` stops an app code being used twice; an emailed code lasts 10 minutes and is
 * sent at most once a minute, five an hour. Five wrong codes of any kind lock the step for
 * 15 minutes. Every change is logged on the platform (Security) and emailed to the person.
 *
 * Platform setting `security.require_2fa` (off, staff, everyone) makes it required: those
 * without it can only reach their security page (lib/api/route.ts) and can't turn it off.
 */

const { eq, inArray } = sql

const MAX_FAILURES = 5
const LOCK_MS = 15 * 60_000
const TRUST_DAYS = 30
export const TRUST_COOKIE = "gl-2fa-trust"
export const ISSUER = "Gretlab"

type Row = typeof twoFactor.$inferSelect
type Method = "app" | "email"

/* ---------- keys, sealing, signing ---------- */

function key(purpose: string) {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret)
    throw new Error("NEXTAUTH_SECRET is needed for two-factor sign-in")
  return Buffer.from(hkdfSync("sha256", secret, "gretlab", purpose, 32))
}

function seal(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key("two-factor secret"), iv)
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(":")
}

function unseal(sealed: string) {
  const [version, iv, tag, body] = sealed.split(":")
  if (version !== "v1" || !iv || !tag || !body)
    throw new Error("Unknown sealed format")
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key("two-factor secret"),
    Buffer.from(iv, "base64")
  )
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

const sign = (text: string) =>
  createHmac("sha256", key("trusted browser")).update(text).digest("base64url")

const nowSeconds = () => Math.floor(Date.now() / 1000)

async function rowOf(userId: string) {
  const [row] = await getDb()
    .select()
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
  return row ?? null
}

async function userByEmail(email: string) {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
  return user && !user.disabled ? user : null
}

const methodsOf = (row: Row | null) => ({
  app: Boolean(row?.enabledAt && row.secret),
  email: Boolean(row?.enabledAt && row.emailOn),
})

/* ---------- telling the person, and the log ---------- */

const log = (actor: User, action: string, summary: string) =>
  writeEntry(getDb(), { orgId: null, actor, action, summary })

/**
 * A security notice: urgent in the outbox (ahead of any backlog), sent right after the
 * response, and retried by the outbox if the provider is down.
 */
async function notice(to: string, subject: string, text: string) {
  await queueEmails(getDb(), [{ to, subject, text }], { urgent: true })
  const send = () =>
    sendUrgent().catch((error) => console.error("[two-factor] notice:", error))
  try {
    after(send)
  } catch {
    void send()
  }
}

/** A notice for the account's owner whenever its sign-in changes. */
function securityNotice(user: User, what: string) {
  const site = process.env.NEXTAUTH_URL ?? ""
  return notice(
    user.email,
    `Security: ${what}`,
    `${what} for your account (${user.email}) on ${new Date().toUTCString()}.\n\n` +
      `If this was you, there's nothing to do. If it wasn't, sign in and check Security, or ` +
      `contact your administrator straight away.\n\n${site}/account/security`
  )
}

/* ---------- who must use it ---------- */

/** Whether the platform's setting requires this person to use two-factor. */
export async function mustUseTwoFactor(user: User) {
  const rule = (await getSettings())["security.require_2fa"]
  if (rule === "off") return false
  if (rule === "everyone") return true
  if (user.role !== "student") return true
  if ((await platformAccess(user)).permissions.length > 0) return true
  const grants = await getDb()
    .select({
      systemKey: orgRoles.systemKey,
      permissions: orgRoles.permissions,
    })
    .from(roleAssignments)
    .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
    .where(eq(roleAssignments.userId, user.id))
  return grants.some((g) => rolePermissions(g).length > 0)
}

/** The security page. */
export async function twoFactorStatus(user: User) {
  const row = await rowOf(user.id)
  const methods = methodsOf(row)
  return {
    enabled: methods.app || methods.email,
    enabledAt: row?.enabledAt ?? null,
    methods,
    emailAvailable: mailEnabled(),
    email: maskEmail(user.email),
    backupCodesLeft: row?.enabledAt ? row.backupCodes.length : 0,
    required: await mustUseTwoFactor(user),
  }
}

/** The second-step page: which ways this person can pass it. */
export async function stepOptions(user: User) {
  const row = await rowOf(user.id)
  return {
    ...methodsOf(row),
    email: methodsOf(row).email && mailEnabled(),
    address: maskEmail(user.email),
  }
}

/* ---------- failures ---------- */

export type StepResult =
  | { ok: true; at: number }
  | { ok: false; reason: "wrong_code" | "locked" | "not_set_up" | "expired" }

const locked = (row: Row) =>
  Boolean(row.lockedUntil && row.lockedUntil > new Date())

async function fail(row: Row): Promise<StepResult> {
  const next = row.failures + 1
  const lock = next >= MAX_FAILURES
  await getDb()
    .update(twoFactor)
    .set({
      failures: lock ? 0 : next,
      lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null,
      // An emailed code dies with the lock.
      ...(lock
        ? { emailCode: null, emailCodeExpires: null }
        : { emailCodeTries: row.emailCodeTries + 1 }),
    })
    .where(eq(twoFactor.userId, row.userId))
  return { ok: false, reason: lock ? "locked" : "wrong_code" }
}

/** Whether a code matches the emailed one still waiting. */
const emailMatches = (row: Row, code: string) =>
  Boolean(
    row.emailCode &&
    row.emailCodeExpires &&
    row.emailCodeExpires > new Date() &&
    row.emailCodeTries < EMAIL_CODE.attempts &&
    row.emailCode === hashEmailCode(row.userId, code)
  )

/* ---------- emailing a code ---------- */

/** Emails a fresh code (replacing any waiting), within the sending limits. */
async function emailCode(
  user: User,
  why: "sign in" | "turn on email codes" | "confirm a security change"
) {
  if (!mailEnabled())
    throw new ApiError(503, "no_mail", "This site can't send email yet.")
  const db = getDb()
  await db.insert(twoFactor).values({ userId: user.id }).onConflictDoNothing()
  const row = (await rowOf(user.id))!
  if (locked(row))
    throw new ApiError(
      429,
      "locked",
      "Too many wrong codes. Try again in 15 minutes."
    )
  const now = new Date()
  const wait = emailWait(
    {
      sentAt: row.emailSentAt,
      sends: row.emailSends,
      windowStart: row.emailWindowStart,
    },
    now
  )
  if (wait > 0)
    throw new ApiError(
      429,
      "wait",
      `You can ask for another code in ${wait} seconds.`,
      wait
    )
  const fresh =
    !row.emailWindowStart ||
    now.getTime() - row.emailWindowStart.getTime() >= 3_600_000
  const code = newEmailCode()
  await db
    .update(twoFactor)
    .set({
      emailCode: hashEmailCode(user.id, code),
      emailCodeExpires: new Date(now.getTime() + EMAIL_CODE.ttlMs),
      emailCodeTries: 0,
      emailSentAt: now,
      emailSends: fresh ? 1 : row.emailSends + 1,
      emailWindowStart: fresh ? now : row.emailWindowStart,
    })
    .where(eq(twoFactor.userId, user.id))
  // Urgent, and sent now while the person waits: a backlog of notices can't hold it up,
  // and a code that couldn't go out within its 10 minutes is dropped, not sent late.
  await queueEmails(
    db,
    [
      {
        to: user.email,
        subject: `Your ${ISSUER} code: ${code}`,
        text:
          `Your code to ${why} is ${code}. It works once, for 10 minutes.\n\n` +
          `If you didn't ask for it, someone may know your Google password: change it, and ignore this email.`,
      },
    ],
    { urgent: true, expiresInMs: EMAIL_CODE.ttlMs }
  )
  const sent = await sendUrgent()
  if (sent.sent === 0 && sent.retrying + sent.failed > 0) {
    // Still queued: the outbox retries it while the code is good.
    throw new ApiError(
      502,
      "mail_delayed",
      "The email service didn't take the code just now. It will keep trying, or ask again in a minute."
    )
  }
  return { sentTo: maskEmail(user.email), resendIn: EMAIL_CODE.resendMs / 1000 }
}

/** At sign-in, for someone owing the second step with email codes on. */
export async function emailSignInCode(user: User) {
  if (!methodsOf(await rowOf(user.id)).email) {
    throw new ApiError(
      400,
      "not_on",
      "Codes by email aren't on for this account."
    )
  }
  return emailCode(user, "sign in")
}

/** While signed in, a code to confirm a change on the security page. */
export async function emailConfirmCode(user: User) {
  if (!methodsOf(await rowOf(user.id)).email) {
    throw new ApiError(
      400,
      "not_on",
      "Codes by email aren't on for this account."
    )
  }
  return emailCode(user, "confirm a security change")
}

/* ---------- turning methods on ---------- */

/** Backup codes come with the first method; later methods keep the ones they have. */
async function pendingBackupCodes(user: User, row: Row | null) {
  if (row?.enabledAt) return null
  const codes = newBackupCodes()
  await getDb()
    .update(twoFactor)
    .set({ pendingBackupCodes: codes.map(hashBackupCode) })
    .where(eq(twoFactor.userId, user.id))
  return codes
}

/** A new app secret (QR and key), pending until a code from the app confirms it. */
export async function startAppSetup(user: User) {
  const secret = newTotpSecret()
  await getDb()
    .insert(twoFactor)
    .values({ userId: user.id, pendingSecret: seal(secret) })
    .onConflictDoUpdate({
      target: twoFactor.userId,
      set: { pendingSecret: seal(secret) },
    })
  const backupCodes = await pendingBackupCodes(user, await rowOf(user.id))
  const url = otpauthUrl({ secret, account: user.email, issuer: ISSUER })
  return {
    secret,
    url,
    qr: await QRCode.toString(url, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
    }),
    backupCodes,
  }
}

/** Emails a code to confirm codes by email will reach them. */
export async function startEmailSetup(user: User) {
  const sent = await emailCode(user, "turn on email codes")
  return {
    ...sent,
    backupCodes: await pendingBackupCodes(user, await rowOf(user.id)),
  }
}

/** Puts a method on; the first one turns two-factor on and brings its backup codes. */
async function turnOn(
  user: User,
  row: Row,
  method: Method,
  extra: Partial<Row>
): Promise<StepResult> {
  const at = new Date()
  const first = !row.enabledAt
  await getDb()
    .update(twoFactor)
    .set({
      ...extra,
      ...(first ? { enabledAt: at, backupCodes: row.pendingBackupCodes } : {}),
      pendingBackupCodes: [],
      failures: 0,
      lockedUntil: null,
    })
    .where(eq(twoFactor.userId, user.id))
  const name = method === "app" ? "an authenticator app" : "codes by email"
  await log(
    user,
    first ? "security.2fa_on" : "security.method_add",
    `${user.email} turned on two-factor sign-in with ${name}`
  )
  await securityNotice(
    user,
    first
      ? `Two-factor sign-in was turned on (${name})`
      : `Two-factor sign-in now also accepts ${name}`
  )
  // The session passes now: at or after enabled_at, whether it was just set or earlier.
  return { ok: true, at: Date.now() }
}

/** Confirms the app with its code (from the jwt callback, so the session passes too). */
export async function confirmApp(
  email: string,
  code: string
): Promise<StepResult> {
  const user = await userByEmail(email)
  const row = user && (await rowOf(user.id))
  if (!user || !row?.pendingSecret) return { ok: false, reason: "not_set_up" }
  if (locked(row)) return { ok: false, reason: "locked" }
  const step = verifyTotp(unseal(row.pendingSecret), code, nowSeconds(), null)
  if (step == null) return fail(row)
  return turnOn(user, row, "app", {
    secret: row.pendingSecret,
    pendingSecret: null,
    lastStep: step,
  })
}

/** Confirms codes by email with the emailed code. */
export async function confirmEmail(
  email: string,
  code: string
): Promise<StepResult> {
  const user = await userByEmail(email)
  const row = user && (await rowOf(user.id))
  if (!user || !row?.emailCode) return { ok: false, reason: "not_set_up" }
  if (locked(row)) return { ok: false, reason: "locked" }
  if (row.emailCodeExpires && row.emailCodeExpires <= new Date())
    return { ok: false, reason: "expired" }
  if (!emailMatches(row, code)) return fail(row)
  return turnOn(user, row, "email", {
    emailOn: true,
    emailCode: null,
    emailCodeExpires: null,
  })
}

/* ---------- the second step ---------- */

/** Checks an app code, an emailed code or a backup code. Clears failures when right. */
async function check(user: User, code: string): Promise<StepResult> {
  const row = await rowOf(user.id)
  if (!row?.enabledAt) return { ok: false, reason: "not_set_up" }
  if (locked(row)) return { ok: false, reason: "locked" }
  const db = getDb()
  const clear = { failures: 0, lockedUntil: null }
  if (row.secret) {
    const step = verifyTotp(
      unseal(row.secret),
      code,
      nowSeconds(),
      row.lastStep
    )
    if (step != null) {
      await db
        .update(twoFactor)
        .set({ ...clear, lastStep: step })
        .where(eq(twoFactor.userId, user.id))
      return { ok: true, at: Date.now() }
    }
  }
  if (row.emailOn && emailMatches(row, code)) {
    await db
      .update(twoFactor)
      .set({ ...clear, emailCode: null, emailCodeExpires: null })
      .where(eq(twoFactor.userId, user.id))
    return { ok: true, at: Date.now() }
  }
  const hash = hashBackupCode(code)
  if (row.backupCodes.includes(hash)) {
    const left = row.backupCodes.filter((h) => h !== hash)
    await db
      .update(twoFactor)
      .set({ ...clear, backupCodes: left })
      .where(eq(twoFactor.userId, user.id))
    await log(
      user,
      "security.backup_code",
      `${user.email} signed in with a backup code (${left.length} left)`
    )
    await securityNotice(
      user,
      `A backup code was used to sign in (${left.length} left)`
    )
    return { ok: true, at: Date.now() }
  }
  return fail(row)
}

/** The second sign-in step, from the jwt callback. */
export async function verifySecondStep(
  email: string,
  code: string
): Promise<StepResult> {
  const user = await userByEmail(email)
  if (!user) return { ok: false, reason: "not_set_up" }
  return check(user, code)
}

const WHY = {
  wrong_code: "That code isn't right.",
  locked: "Too many wrong codes. Try again in 15 minutes.",
  not_set_up: "Two-factor sign-in isn't on.",
  expired: "That code has expired. Ask for a new one.",
} as const

async function needCode(user: User, code: string) {
  const result = await check(user, code)
  if (!result.ok)
    throw new ApiError(
      result.reason === "locked" ? 429 : 400,
      result.reason,
      WHY[result.reason]
    )
}

/* ---------- turning off, backup codes, trusted browsers ---------- */

/**
 * Takes one method away, with a current code (any method, or a backup code). Taking the
 * last one away turns two-factor off, which isn't allowed while it's required.
 */
export async function removeMethod(user: User, method: Method, code: string) {
  const row = await rowOf(user.id)
  const methods = methodsOf(row)
  if (!methods[method]) throw new ApiError(400, "not_on", "That isn't on.")
  const last = !(method === "app" ? methods.email : methods.app)
  if (last && (await mustUseTwoFactor(user))) {
    throw new ApiError(
      403,
      "required",
      "Two-factor sign-in is required for your account, so its last method can't be removed."
    )
  }
  await needCode(user, code)
  const db = getDb()
  if (last) {
    await db.delete(twoFactor).where(eq(twoFactor.userId, user.id))
    await log(
      user,
      "security.2fa_off",
      `${user.email} turned off two-factor sign-in`
    )
    await securityNotice(user, "Two-factor sign-in was turned off")
    return { enabled: false }
  }
  await db
    .update(twoFactor)
    .set(
      method === "app"
        ? { secret: null, lastStep: null }
        : { emailOn: false, emailCode: null }
    )
    .where(eq(twoFactor.userId, user.id))
  const name = method === "app" ? "the authenticator app" : "codes by email"
  await log(
    user,
    "security.method_remove",
    `${user.email} removed ${name} from two-factor sign-in`
  )
  await securityNotice(user, `Two-factor sign-in no longer accepts ${name}`)
  return { enabled: true }
}

/** New backup codes for old ones, with a current code. */
export async function renewBackupCodes(user: User, code: string) {
  await needCode(user, code)
  const codes = newBackupCodes()
  await getDb()
    .update(twoFactor)
    .set({ backupCodes: codes.map(hashBackupCode) })
    .where(eq(twoFactor.userId, user.id))
  await log(
    user,
    "security.backup_codes",
    `${user.email} made new backup codes`
  )
  await securityNotice(
    user,
    "New backup codes were made; the old ones no longer work"
  )
  return { backupCodes: codes }
}

/**
 * A cookie that lets this browser skip the second step for 30 days. It names the person,
 * when it ends, which trust version and which turn-on it belongs to, signed; forgetting
 * browsers (a new version) or turning two-factor off and on again voids it.
 */
export async function trustCookie(user: User) {
  const row = await rowOf(user.id)
  if (!row?.enabledAt)
    throw new ApiError(400, "not_on", "Two-factor sign-in isn't on.")
  const expires = Date.now() + TRUST_DAYS * 86_400_000
  const body = Buffer.from(
    JSON.stringify({
      u: user.id,
      e: expires,
      v: row.trustVersion,
      t: row.enabledAt.getTime(),
    })
  ).toString("base64url")
  return { value: `${body}.${sign(body)}`, expires: new Date(expires) }
}

/** Whether a trust cookie is valid for this person as their two-factor stands now. */
export function trusted(
  value: string | undefined,
  user: { id: string },
  row: { enabledAt: Date | null; trustVersion: number }
) {
  if (!value || !row.enabledAt) return false
  const [body, mac] = value.split(".")
  if (!body || !mac) return false
  const expected = Buffer.from(sign(body))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return false
  try {
    const claim = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as { u: string; e: number; v: number; t: number }
    return (
      claim.u === user.id &&
      claim.e > Date.now() &&
      claim.v === row.trustVersion &&
      claim.t === row.enabledAt.getTime()
    )
  } catch {
    return false
  }
}

/** Every trusted browser has to do the second step again. */
export async function forgetBrowsers(user: User) {
  const row = await rowOf(user.id)
  if (!row) return { forgotten: true }
  await getDb()
    .update(twoFactor)
    .set({ trustVersion: row.trustVersion + 1 })
    .where(eq(twoFactor.userId, user.id))
  await log(
    user,
    "security.forget_browsers",
    `${user.email} made every browser ask for the second step again`
  )
  return { forgotten: true }
}

/* ---------- platform staff ---------- */

/** For someone who lost every method and code: platform staff turn their two-factor off. */
export async function resetFor(actor: User, userId: string) {
  const [target] = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, userId))
  if (!target) throw new ApiError(404, "not_found", "User not found")
  if (target.id === actor.id)
    throw new ApiError(
      400,
      "self_change",
      "Use your own security page for that."
    )
  const [mine, theirs] = await Promise.all([
    platformAccess(actor),
    platformAccess(target),
  ])
  if (
    (theirs.owner && !mine.owner) ||
    !theirs.permissions.every((p) => mine.permissions.includes(p))
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "You can't change the sign-in of someone with more access than you."
    )
  }
  const removed = await getDb()
    .delete(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .returning()
  if (!removed.some((r) => r.enabledAt))
    throw new ApiError(400, "not_on", "Two-factor sign-in isn't on for them.")
  await log(
    actor,
    "security.2fa_reset",
    `Turned off two-factor sign-in for ${target.email}`
  )
  await securityNotice(
    target,
    "Two-factor sign-in was turned off by an administrator"
  )
  return { reset: true }
}

/** Which of these people have two-factor on (for the users list). */
export async function twoFactorOn(userIds: string[]) {
  if (userIds.length === 0) return new Set<string>()
  const rows = await getDb()
    .select({ userId: twoFactor.userId, enabledAt: twoFactor.enabledAt })
    .from(twoFactor)
    .where(inArray(twoFactor.userId, userIds))
  return new Set(rows.filter((r) => r.enabledAt).map((r) => r.userId))
}
