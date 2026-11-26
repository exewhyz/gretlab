/**
 * Passkeys (the owner's decisions, 26 November 2026): Face ID, Touch ID, Windows Hello, Android
 * or a security key, through WebAuthn with @simplewebauthn/server. A passkey is a two-factor
 * method beside the authenticator app and emailed codes: adding the first turns two-factor on
 * (with backup codes), it passes the second step and step-up, and it signs its owner in on its
 * own, since it's made with user verification (a fingerprint, a face or a PIN: two factors in one).
 * Challenges are kept on the server, used once within five minutes.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server"

import {
  getDb,
  passkeys,
  sql,
  twoFactor,
  users,
  webauthnChallenges,
  type User,
} from "@workspace/db"
import { z } from "zod"

import { ApiError, notFound } from "@/lib/api/errors"

import {
  log,
  mustUseTwoFactor,
  pendingBackupCodes,
  rowOf,
  securityNotice,
  turnOn,
} from "./two-factor"

const { and, asc, eq, gt, isNull } = sql

const CHALLENGE_MS = 5 * 60_000
const MAX_PASSKEYS = 10

/** Who the passkeys belong to: this site, by its address. */
function relyingParty() {
  const url = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000")
  return { rpID: url.hostname, origin: url.origin, rpName: "GretLab" }
}

async function saveChallenge(
  challenge: string,
  purpose: "register" | "sign_in" | "step",
  userId: string | null
) {
  const [row] = await getDb()
    .insert(webauthnChallenges)
    .values({
      challenge,
      purpose,
      userId,
      expiresAt: new Date(Date.now() + CHALLENGE_MS),
    })
    .returning({ id: webauthnChallenges.id })
  return row!.id
}

/** The challenge, used once: refused if unknown, for something else, someone else's, or old. */
async function useChallenge(
  id: string,
  purpose: "register" | "sign_in" | "step",
  userId: string | null
) {
  const [row] = await getDb()
    .update(webauthnChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(webauthnChallenges.id, id),
        eq(webauthnChallenges.purpose, purpose),
        isNull(webauthnChallenges.usedAt),
        gt(webauthnChallenges.expiresAt, new Date()),
        userId
          ? eq(webauthnChallenges.userId, userId)
          : isNull(webauthnChallenges.userId)
      )
    )
    .returning({ challenge: webauthnChallenges.challenge })
  if (!row)
    throw new ApiError(
      400,
      "bad_challenge",
      "That took too long, or was already used. Try again."
    )
  return row.challenge
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url")
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, "base64url"))

/* ---------- adding one (Account › Security) ---------- */

export async function registrationOptions(user: User) {
  const own = await getDb()
    .select()
    .from(passkeys)
    .where(eq(passkeys.userId, user.id))
  if (own.length >= MAX_PASSKEYS)
    throw new ApiError(
      409,
      "too_many",
      `At most ${MAX_PASSKEYS} passkeys. Remove one first.`
    )
  const rp = relyingParty()
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.email,
    userID: new TextEncoder().encode(user.id),
    userDisplayName: user.name ?? user.email,
    attestationType: "none",
    // Not the same authenticator twice.
    excludeCredentials: own.map((p) => ({
      id: p.credentialId,
      transports: p.transports,
    })),
    // Discoverable, with user verification: so it can sign in on its own.
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  })
  // The first method brings backup codes, shown once (as for the authenticator app).
  await getDb()
    .insert(twoFactor)
    .values({ userId: user.id })
    .onConflictDoNothing()
  const backupCodes = await pendingBackupCodes(user, await rowOf(user.id))
  return {
    options,
    challengeId: await saveChallenge(options.challenge, "register", user.id),
    backupCodes,
  }
}

export const registerSchema = z.object({
  challengeId: z.uuid(),
  name: z.string().trim().min(1).max(60),
  response: z.custom<RegistrationResponseJSON>(
    (v) => typeof v === "object" && v !== null
  ),
})

export async function register(
  user: User,
  input: z.infer<typeof registerSchema>
) {
  const challenge = await useChallenge(input.challengeId, "register", user.id)
  const rp = relyingParty()
  let verified
  try {
    verified = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    })
  } catch {
    throw new ApiError(
      400,
      "bad_passkey",
      "That passkey couldn't be checked. Try again."
    )
  }
  if (!verified.verified)
    throw new ApiError(
      400,
      "bad_passkey",
      "That passkey couldn't be checked. Try again."
    )
  const { credential, credentialBackedUp } = verified.registrationInfo
  const db = getDb()
  const [saved] = await db
    .insert(passkeys)
    .values({
      userId: user.id,
      credentialId: credential.id,
      publicKey: b64(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      backedUp: credentialBackedUp,
      name: input.name,
    })
    .onConflictDoNothing()
    .returning({ id: passkeys.id })
  if (!saved)
    throw new ApiError(409, "already_added", "That passkey is already added.")
  const row = (await rowOf(user.id))!
  if (row.enabledAt && row.passkeyOn) {
    await log(
      user,
      "security.passkey_add",
      `${user.email} added a passkey (${input.name})`
    )
    await securityNotice(user, `A passkey was added (${input.name})`)
    return { id: saved.id }
  }
  // The first passkey: a new method, or two-factor's first (turning it on).
  await turnOn(user, row, "passkey", { passkeyOn: true })
  return { id: saved.id }
}

/** The person's passkeys, for the security page. */
export async function listPasskeys(user: User) {
  return getDb()
    .select({
      id: passkeys.id,
      name: passkeys.name,
      backedUp: passkeys.backedUp,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id))
    .orderBy(asc(passkeys.createdAt))
}

/**
 * Removes one (its route asks for a recent second step). The last passkey takes the method
 * away; if it was the only method, two-factor goes off, which isn't allowed while required.
 */
export async function removePasskey(user: User, id: string) {
  const db = getDb()
  const own = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.userId, user.id))
  const target = own.find((p) => p.id === id)
  if (!target) throw notFound("Passkey not found")
  const row = await rowOf(user.id)
  const lastPasskey = own.length === 1
  const otherMethods = Boolean(row?.secret || row?.emailOn)
  if (lastPasskey && !otherMethods && (await mustUseTwoFactor(user)))
    throw new ApiError(
      403,
      "required",
      "Two-factor sign-in is required for your account, so its last method can't be removed."
    )
  await db.delete(passkeys).where(eq(passkeys.id, id))
  if (lastPasskey && !otherMethods) {
    await db.delete(twoFactor).where(eq(twoFactor.userId, user.id))
    await log(
      user,
      "security.2fa_off",
      `${user.email} turned off two-factor sign-in`
    )
    await securityNotice(user, "Two-factor sign-in was turned off")
    return { enabled: false }
  }
  if (lastPasskey)
    await db
      .update(twoFactor)
      .set({ passkeyOn: false })
      .where(eq(twoFactor.userId, user.id))
  await log(
    user,
    "security.passkey_remove",
    `${user.email} removed a passkey (${target.name})`
  )
  await securityNotice(user, `A passkey was removed (${target.name})`)
  return { enabled: true }
}

/* ---------- using one ---------- */

/**
 * Options for using a passkey: to sign in (anyone's, the browser offers the ones it holds,
 * with user verification), or for the second step and step-up (this person's own).
 */
export async function authenticationOptions(user: User | null) {
  const rp = relyingParty()
  const own = user
    ? await getDb().select().from(passkeys).where(eq(passkeys.userId, user.id))
    : []
  if (user && own.length === 0)
    throw new ApiError(400, "no_passkey", "You haven't added a passkey.")
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: own.map((p) => ({
      id: p.credentialId,
      transports: p.transports,
    })),
    userVerification: user ? "preferred" : "required",
  })
  return {
    options,
    challengeId: await saveChallenge(
      options.challenge,
      user ? "step" : "sign_in",
      user?.id ?? null
    ),
  }
}

export const assertionSchema = z.object({
  challengeId: z.uuid(),
  response: z.custom<AuthenticationResponseJSON>(
    (v) => typeof v === "object" && v !== null
  ),
})

/**
 * Checks a passkey's answer. For signing in (no `email`), whoever's passkey it is, with user
 * verification; for the second step and step-up, it must be this person's own. The counter
 * must move forward when the authenticator keeps one (a clone would repeat it).
 */
export async function verifyAssertion(
  input: z.infer<typeof assertionSchema>,
  email: string | null
): Promise<User> {
  const db = getDb()
  const [me] = email
    ? await db.select().from(users).where(eq(users.email, email.toLowerCase()))
    : [null]
  if (email && !me)
    throw new ApiError(400, "bad_passkey", "That passkey isn't right.")
  const challenge = await useChallenge(
    input.challengeId,
    me ? "step" : "sign_in",
    me?.id ?? null
  )
  const [found] = await db
    .select({ passkey: passkeys, user: users })
    .from(passkeys)
    .innerJoin(users, eq(passkeys.userId, users.id))
    .where(eq(passkeys.credentialId, String(input.response.id ?? "")))
  if (!found || (me && found.user.id !== me.id))
    throw new ApiError(400, "bad_passkey", "That passkey isn't right.")
  if (found.user.disabled)
    throw new ApiError(403, "blocked", "This account is blocked.")
  const rp = relyingParty()
  let result
  try {
    result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: found.passkey.credentialId,
        publicKey: unb64(found.passkey.publicKey),
        counter: found.passkey.counter,
        transports: found.passkey.transports,
      },
      requireUserVerification: !me,
    })
  } catch {
    throw new ApiError(400, "bad_passkey", "That passkey isn't right.")
  }
  if (!result.verified)
    throw new ApiError(400, "bad_passkey", "That passkey isn't right.")
  const next = result.authenticationInfo.newCounter
  if (found.passkey.counter > 0 && next <= found.passkey.counter)
    throw new ApiError(
      400,
      "cloned_passkey",
      "That passkey looks copied. Remove it and add it again."
    )
  await db
    .update(passkeys)
    .set({ counter: next, lastUsedAt: new Date() })
    .where(eq(passkeys.id, found.passkey.id))
  return found.user
}

/* ---------- through the session update (features/auth/options.ts) ---------- */

/** What the jwt callback records: passed now, or why not. */
export type PasskeyStepResult =
  { ok: true; at: number } | { ok: false; reason: string }

const reasonOf = (error: unknown) =>
  error instanceof ApiError ? error.code : "bad_passkey"

/** The second step, or confirming a protected action (logged like a code would be). */
export async function passkeyStep(
  email: string,
  data: unknown,
  stepUp: boolean
): Promise<PasskeyStepResult> {
  const parsed = assertionSchema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: "bad_passkey" }
  try {
    const user = await verifyAssertion(parsed.data, email)
    if (stepUp)
      await log(
        user,
        "security.step_up",
        "Confirmed with a passkey for a protected action"
      )
    return { ok: true, at: Date.now() }
  } catch (error) {
    return { ok: false, reason: reasonOf(error) }
  }
}

/**
 * Adding a passkey, through the session update so that, when it's the first method and turns
 * two-factor on, this session passes at the same moment (as confirming the app does). Only
 * from a session that isn't waiting for its second step: with two-factor already on, it must
 * have passed it within the last ten minutes, or a half-signed-in session could add its own
 * way through.
 */
export async function passkeyRegisterStep(
  email: string,
  data: unknown,
  mfaAt: number | null
): Promise<PasskeyStepResult> {
  const parsed = registerSchema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: "bad_passkey" }
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
  if (!user || user.disabled) return { ok: false, reason: "not_set_up" }
  const row = await rowOf(user.id)
  if (row?.enabledAt) {
    const recent =
      mfaAt !== null &&
      mfaAt >= row.enabledAt.getTime() &&
      Date.now() - mfaAt < 10 * 60_000
    if (!recent) return { ok: false, reason: "step_up_required" }
  }
  try {
    await register(user, parsed.data)
    return { ok: true, at: Date.now() }
  } catch (error) {
    return { ok: false, reason: reasonOf(error) }
  }
}

/** Challenges past their five minutes, used or not: nothing needs them (the email cron). */
export async function tidyPasskeyChallenges() {
  await getDb()
    .delete(webauthnChallenges)
    .where(
      sql.lt(webauthnChallenges.expiresAt, new Date(Date.now() - 60 * 60_000))
    )
}
