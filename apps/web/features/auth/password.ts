import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"

import { authTokens, emailOutbox, getDb, sql, users, type User } from "@workspace/db"
import {
  AUTH_LINK_MINUTES,
  emailDomainAllowed,
  PASSWORD,
  PASSWORD_LOCK,
  passwordProblem,
  type EmailTemplateKey,
} from "@workspace/judge"
import { after } from "next/server"
import { z } from "zod"

import { writeEntry } from "@/features/audit/server"
import { composeEmail } from "@/features/emails/server"
import { freeHandle } from "@/features/catalog/server"
import { queueEmails, sendUrgent } from "@/features/notifications/outbox"
import { getSettings } from "@/features/settings/server"
import { isAdminEmail } from "@/lib/admin-emails"
import { ApiError } from "@/lib/api/route"

/*
 * Sign-in with email and password, beside Google (features/auth/options.ts).
 *
 *   sign up ──► account without a verified address ──► link by email (24 h) ──► verified
 *   forgot  ──► link by email (1 h) ──► new password: verified, other sessions signed out
 *
 * Passwords are hashed with scrypt (N=2^15, r=8, p=1, 16-byte salt), compared in constant
 * time. Rules: packages/judge/src/passwords.ts. Five wrong passwords in a row hold password
 * sign-in for 15 minutes (Google still works). Answers never say whether an address has
 * an account: sign-up and "forgot" always say "check your email", and the email itself
 * says what happened. Links are random 32 bytes; only their SHA-256 is stored, and each
 * works once. The second sign-in step applies exactly as after Google.
 */

const { and, eq, gt, isNull } = sql

/* ---------- hashing ---------- */

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32 } as const

function derive(password: string, salt: Buffer, o: { N: number; r: number; p: number; keylen: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    const options: ScryptOptions = { N: o.N, r: o.r, p: o.p, maxmem: 128 * o.N * o.r * 2 }
    scrypt(password.normalize("NFKC"), salt, o.keylen, options, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  })
}

/** "scrypt$N$r$p$salt$hash", base64url: the parameters travel with the hash. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await derive(password, salt, SCRYPT)
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$")
}

export async function passwordMatches(password: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split("$")
  if (scheme !== "scrypt" || !salt || !hash) return false
  const expected = Buffer.from(hash, "base64url")
  const key = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// Compared against when there's no account, so a missing account takes as long as a wrong password.
let decoy: Promise<string> | null = null
const decoyHash = () => (decoy ??= hashPassword(randomBytes(12).toString("hex")))

/* ---------- links ---------- */

const digest = (token: string) => createHash("sha256").update(token).digest("hex")
const site = () => process.env.NEXTAUTH_URL ?? ""

async function newLink(userId: string, kind: "verify" | "reset") {
  const token = randomBytes(32).toString("base64url")
  const db = getDb()
  // One live link of a kind at a time: a new one retires the old.
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)))
  await db.insert(authTokens).values({
    userId,
    kind,
    tokenHash: digest(token),
    expiresAt: new Date(Date.now() + AUTH_LINK_MINUTES[kind] * 60_000),
  })
  return `${site()}/${kind === "verify" ? "verify-email" : "reset-password"}?token=${token}`
}

/** Whether a link of this kind went to them in the last minute: no more than one a minute. */
async function sentRecently(userId: string, kind: "verify" | "reset") {
  const [row] = await getDb()
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.kind, kind),
        gt(authTokens.createdAt, new Date(Date.now() - 60_000))
      )
    )
    .limit(1)
  return Boolean(row)
}

/** Whether any account email went to this address in the last few minutes. */
async function mailedRecently(to: string, minutes: number) {
  const [row] = await getDb()
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.to, to), gt(emailOutbox.createdAt, new Date(Date.now() - minutes * 60_000))))
    .limit(1)
  return Boolean(row)
}

/** Uses up a link: its person, or null when it's unknown, used or expired. */
async function useLink(token: string, kind: "verify" | "reset") {
  const [row] = await getDb()
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, digest(token)),
        eq(authTokens.kind, kind),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date())
      )
    )
    .returning({ userId: authTokens.userId })
  if (!row) return null
  const [user] = await getDb().select().from(users).where(eq(users.id, row.userId))
  return user && !user.disabled ? user : null
}

/** Whether a link is still good, without using it (the reset page checks before asking). */
export async function linkValid(token: string, kind: "verify" | "reset") {
  const [row] = await getDb()
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, digest(token)),
        eq(authTokens.kind, kind),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date())
      )
    )
  return Boolean(row)
}

/* ---------- email ---------- */

/** An account email: urgent (ahead of any backlog) and sent right after the response. */
async function mail(to: string, key: EmailTemplateKey, values: Record<string, string>) {
  await queueEmails(getDb(), [{ to, ...(await composeEmail(key, values)) }], { urgent: true })
  const send = () => sendUrgent().catch((error) => console.error("[password] mail:", error))
  try {
    after(send)
  } catch {
    void send()
  }
}

const log = (actor: User, action: string, summary: string) =>
  writeEntry(getDb(), { orgId: null, actor, action, summary })

/* ---------- sign up ---------- */

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name").max(120),
  email: z.email("Enter an email address").max(254).transform((e) => e.trim().toLowerCase()),
  password: z.string().max(PASSWORD.max),
})

/** Whether this site takes new accounts from this address (the registration settings). */
async function mayRegister(email: string) {
  if (isAdminEmail(email)) return true
  const settings = await getSettings()
  if (!settings["registration.enabled"]) return false
  return emailDomainAllowed(email, settings["registration.allowed_email_domains"])
}

/**
 * Makes an account and emails a link to confirm the address. For an address that already
 * has an account, the email says so instead: the answer here is the same either way.
 */
export async function signUp(input: z.infer<typeof signUpSchema>) {
  const problem = passwordProblem(input.password, input.email)
  if (problem) throw new ApiError(400, "weak_password", problem)
  if (!(await mayRegister(input.email)))
    throw new ApiError(403, "registration_closed", "New accounts can't be made with this address here.")
  const db = getDb()
  const [existing] = await db.select().from(users).where(eq(users.email, input.email))
  if (existing) {
    if (!existing.disabled) {
      if (!existing.emailVerifiedAt && existing.passwordHash) {
        // Signed up before and never confirmed: a fresh link, with the new password.
        await db
          .update(users)
          .set({ passwordHash: await hashPassword(input.password), name: input.name })
          .where(eq(users.id, existing.id))
        if (!(await sentRecently(existing.id, "verify"))) {
          const link = await newLink(existing.id, "verify")
          await mail(input.email, "account.confirm", { name: input.name, link })
        }
      } else {
        if (!(await mailedRecently(input.email, 10)))
          await mail(input.email, "account.exists", {
            email: input.email,
            signInLink: `${site()}/sign-in`,
            resetLink: `${site()}/forgot-password`,
          })
      }
    }
    return { sent: true }
  }
  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      name: input.name,
      handle: await freeHandle(input.email),
      role: "student",
      passwordHash: await hashPassword(input.password),
    })
    .onConflictDoNothing({ target: users.email })
    .returning()
  if (user) {
    const link = await newLink(user.id, "verify")
    await mail(input.email, "account.confirm", { name: input.name, link })
    await log(user, "account.sign_up", `Signed up with email and password (${input.email})`)
  }
  return { sent: true }
}

/** Confirms an address from its emailed link. */
export const tokenSchema = z.object({ token: z.string().min(10).max(200) })

export async function verifyEmail(token: string) {
  const user = await useLink(token, "verify")
  if (!user) return null
  await getDb()
    .update(users)
    .set({ emailVerifiedAt: user.emailVerifiedAt ?? new Date(), role: isAdminEmail(user.email) ? "admin" : user.role })
    .where(eq(users.id, user.id))
  await log(user, "account.verify_email", `Confirmed ${user.email}`)
  return { email: user.email }
}

export const emailSchema = z.object({
  email: z.email("Enter an email address").max(254).transform((e) => e.trim().toLowerCase()),
})

/** Sends a new confirmation link to an account that hasn't confirmed its address yet. */
export async function resendConfirmation(email: string) {
  const [user] = await getDb().select().from(users).where(eq(users.email, email))
  if (user && !user.disabled && !user.emailVerifiedAt && user.passwordHash && !(await sentRecently(user.id, "verify"))) {
    await mail(email, "account.confirm", { name: user.name ?? "there", link: await newLink(user.id, "verify") })
  }
  return { sent: true }
}

/* ---------- forgotten passwords ---------- */

/** Emails a link to choose a new password (to any account, Google ones included). */
export async function forgotPassword(email: string) {
  const [user] = await getDb().select().from(users).where(eq(users.email, email))
  if (user && !user.disabled && !(await sentRecently(user.id, "reset"))) {
    const link = await newLink(user.id, "reset")
    await mail(email, "account.reset", { name: user.name ?? "there", email, link })
  }
  return { sent: true }
}

export const resetSchema = z.object({ token: z.string().min(10).max(200), password: z.string().max(PASSWORD.max) })

/**
 * A new password from an emailed link. It also confirms the address, clears any hold,
 * and signs out every session (on every device) from before.
 */
export async function resetPassword(input: z.infer<typeof resetSchema>) {
  if (!(await linkValid(input.token, "reset")))
    throw new ApiError(400, "bad_link", "This link has expired or was already used. Ask for a new one.")
  const [row] = await getDb()
    .select({ email: users.email })
    .from(authTokens)
    .innerJoin(users, eq(authTokens.userId, users.id))
    .where(eq(authTokens.tokenHash, digest(input.token)))
  const problem = passwordProblem(input.password, row?.email ?? "")
  if (problem) throw new ApiError(400, "weak_password", problem)
  const user = await useLink(input.token, "reset")
  if (!user) throw new ApiError(400, "bad_link", "This link has expired or was already used. Ask for a new one.")
  await getDb()
    .update(users)
    .set({
      passwordHash: await hashPassword(input.password),
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      passwordFailures: 0,
      passwordLockedUntil: null,
      sessionsValidAfter: new Date(),
    })
    .where(eq(users.id, user.id))
  await changedNotice(user, "Your password was reset")
  await log(user, "account.password_reset", "Reset their password from an emailed link")
  return { ok: true }
}

function changedNotice(user: User, what: string) {
  return mail(user.email, "account.security", {
    what,
    email: user.email,
    when: new Date().toUTCString(),
    link: `${site()}/account/security`,
  })
}

/* ---------- signed in: setting or changing it ---------- */

export const changeSchema = z.object({
  current: z.string().max(PASSWORD.max).optional(),
  password: z.string().max(PASSWORD.max),
})

/** Sets a password (a Google account adding one) or changes it (needs the current one). */
export async function changePassword(user: User, input: z.infer<typeof changeSchema>) {
  const [row] = await getDb().select().from(users).where(eq(users.id, user.id))
  if (!row) throw new ApiError(404, "not_found", "No such account")
  if (row.passwordHash) {
    if (!input.current || !(await passwordMatches(input.current, row.passwordHash)))
      throw new ApiError(400, "wrong_password", "Your current password isn't right.")
  }
  const problem = passwordProblem(input.password, row.email)
  if (problem) throw new ApiError(400, "weak_password", problem)
  await getDb()
    .update(users)
    .set({ passwordHash: await hashPassword(input.password), passwordFailures: 0, passwordLockedUntil: null })
    .where(eq(users.id, user.id))
  const what = row.passwordHash ? "Your password was changed" : "A password was added to your account"
  await changedNotice(row, what)
  await log(row, row.passwordHash ? "account.password_change" : "account.password_set", what)
  return { ok: true }
}

/** Signs this person out on every device, this one included. */
export async function signOutEverywhere(user: User) {
  await getDb().update(users).set({ sessionsValidAfter: new Date() }).where(eq(users.id, user.id))
  await log(user, "account.sign_out_everywhere", "Signed out on every device")
  return { ok: true }
}

/** Whether this person has a password, for Account › Security. */
export async function passwordStatus(user: User) {
  const [row] = await getDb()
    .select({ hash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
  return { hasPassword: Boolean(row?.hash) }
}

/* ---------- signing in ---------- */

export type PasswordSignIn =
  | { ok: true; user: User }
  | { ok: false; reason: "wrong" | "unverified" | "locked" }

/**
 * Checks an email and password for the credentials provider. A wrong password counts
 * toward the hold; a right one clears it. Unknown addresses take as long as wrong ones.
 */
export async function checkPassword(rawEmail: string, password: string): Promise<PasswordSignIn> {
  const email = rawEmail.trim().toLowerCase()
  const [user] = email ? await getDb().select().from(users).where(eq(users.email, email)) : []
  if (!user || !user.passwordHash || user.disabled) {
    await passwordMatches(password, await decoyHash())
    return { ok: false, reason: "wrong" }
  }
  if (user.passwordLockedUntil && user.passwordLockedUntil > new Date()) return { ok: false, reason: "locked" }
  if (!(await passwordMatches(password, user.passwordHash))) {
    const failures = user.passwordFailures + 1
    const lock = failures >= PASSWORD_LOCK.failures
    await getDb()
      .update(users)
      .set({
        passwordFailures: lock ? 0 : failures,
        passwordLockedUntil: lock ? new Date(Date.now() + PASSWORD_LOCK.minutes * 60_000) : user.passwordLockedUntil,
      })
      .where(eq(users.id, user.id))
    if (lock) await changedNotice(user, `Password sign-in was paused for ${PASSWORD_LOCK.minutes} minutes after ${PASSWORD_LOCK.failures} wrong passwords`)
    return { ok: false, reason: lock ? "locked" : "wrong" }
  }
  if (!user.emailVerifiedAt) return { ok: false, reason: "unverified" }
  if (user.passwordFailures || user.passwordLockedUntil)
    await getDb().update(users).set({ passwordFailures: 0, passwordLockedUntil: null }).where(eq(users.id, user.id))
  return { ok: true, user }
}
