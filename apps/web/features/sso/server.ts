/**
 * College single sign-on with OpenID Connect (the owner's decisions, 26 November 2026; rules
 * packages/judge/src/sso.ts). A college connects its identity provider (Microsoft Entra, Google
 * Workspace, Okta, Keycloak) under Manage › Single sign-on; platform staff give it the email
 * domains it may sign in, so it can never vouch for someone else's address. Signing in through
 * it finds (or makes) the account, makes it an active member, and goes through the second step
 * like any sign-in. A college may require it for its domains.
 */
import { createHash, randomBytes, type JsonWebKey } from "node:crypto"

import {
  getDb,
  organizations,
  orgMembers,
  orgSso,
  sql,
  ssoStates,
  ssoUsers,
  users,
  type User,
} from "@workspace/db"
import { checkIdToken, emailDomain, ssoDomainProblem } from "@workspace/judge"
import { z } from "zod"

import { writeEntry } from "@/features/audit/server"
import { needRoom } from "@/features/billing/limits"
import { freeHandle } from "@/features/catalog/server"
import { verifyJwt } from "@/features/lti/jwt"
import { orgContext, need, writeAudit } from "@/features/orgs/server"
import { writePlatformAudit } from "@/features/platform/staff"
import { ApiError, notFound } from "@/lib/api/route"
import { seal, unseal } from "@/lib/sealed"

const { and, eq, gt, isNull } = sql

const STATE_MINUTES = 10
const SEAL = "sso"
const random = () => randomBytes(32).toString("base64url")

/** Where GretLab is reached, for the address the IdP sends people back to. */
export const siteOrigin = (fallback: string) =>
  process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? fallback
export const callbackUrl = (origin: string) =>
  `${siteOrigin(origin)}/api/v1/sso/callback`

/** IdP addresses must be https in production (http for local testing only). */
function checkUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const httpOk =
    process.env.NODE_ENV !== "production" ||
    process.env.SSO_ALLOW_HTTP === "true"
  return url.protocol === "https:" || (httpOk && url.protocol === "http:")
}

/* ---------- the organization's settings ---------- */

export async function ssoSettings(slug: string, user: User, origin: string) {
  const ctx = await orgContext(slug, user)
  need(ctx, "org.settings.manage")
  const [row] = await getDb()
    .select()
    .from(orgSso)
    .where(eq(orgSso.orgId, ctx.org.id))
  return {
    issuer: row?.issuer ?? "",
    clientId: row?.clientId ?? "",
    hasSecret: Boolean(row?.clientSecret),
    enabled: row?.enabled ?? false,
    required: row?.required ?? false,
    /** Given by platform staff: the addresses it may sign in. */
    domains: row?.domains ?? [],
    /** What to give the identity provider as the redirect address. */
    redirectUri: callbackUrl(origin),
  }
}

export const ssoSettingsSchema = z.object({
  issuer: z.string().trim().max(500),
  clientId: z.string().trim().max(500),
  /** Left out or empty: keep the one saved. */
  clientSecret: z.string().max(2000).optional(),
  enabled: z.boolean(),
  required: z.boolean(),
})

/** The issuer's discovery document, checked: the same issuer, https endpoints. */
async function discover(issuer: string) {
  if (!checkUrl(issuer))
    throw new ApiError(
      400,
      "bad_issuer",
      "The issuer must be an https address."
    )
  let doc: Record<string, unknown>
  try {
    const res = await fetch(
      `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
      {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      }
    )
    if (!res.ok) throw new Error(String(res.status))
    doc = (await res.json()) as Record<string, unknown>
  } catch {
    throw new ApiError(
      400,
      "no_discovery",
      "Couldn't read the identity provider's settings at that issuer. Check the address."
    )
  }
  if (doc.issuer !== issuer)
    throw new ApiError(
      400,
      "bad_issuer",
      `The identity provider calls itself ${String(doc.issuer)}; use exactly that as the issuer.`
    )
  const {
    authorization_endpoint: auth,
    token_endpoint: token,
    jwks_uri: jwks,
  } = doc
  if (!checkUrl(auth) || !checkUrl(token) || !checkUrl(jwks))
    throw new ApiError(
      400,
      "bad_discovery",
      "The identity provider's settings are missing secure addresses."
    )
  return { authorizationEndpoint: auth, tokenEndpoint: token, jwksUri: jwks }
}

export async function saveSsoSettings(
  slug: string,
  user: User,
  input: z.infer<typeof ssoSettingsSchema>
) {
  const ctx = await orgContext(slug, user)
  need(ctx, "org.settings.manage")
  const db = getDb()
  const [row] = await db
    .select()
    .from(orgSso)
    .where(eq(orgSso.orgId, ctx.org.id))
  const secret = input.clientSecret
    ? seal(SEAL, input.clientSecret)
    : (row?.clientSecret ?? "")
  const connecting = input.issuer !== "" || input.clientId !== ""
  const endpoints = connecting
    ? await discover(input.issuer)
    : { authorizationEndpoint: "", tokenEndpoint: "", jwksUri: "" }
  if (input.enabled) {
    if (!input.issuer || !input.clientId || !secret)
      throw new ApiError(
        400,
        "incomplete",
        "Fill in the issuer, client ID and client secret before switching it on."
      )
    if (!row?.domains.length)
      throw new ApiError(
        400,
        "no_domains",
        "GretLab hasn't confirmed your email domains yet. Ask us to add them."
      )
  }
  const values = {
    issuer: input.issuer,
    clientId: input.clientId,
    clientSecret: secret,
    ...endpoints,
    enabled: input.enabled,
    required: input.enabled && input.required,
  }
  await db
    .insert(orgSso)
    .values({ orgId: ctx.org.id, ...values })
    .onConflictDoUpdate({ target: orgSso.orgId, set: values })
  // The secret is only ever logged as changed.
  await writeAudit(
    ctx,
    "org.sso",
    input.enabled ? "Set up single sign-on" : "Changed single sign-on (off)",
    {
      issuer: input.issuer,
      clientId: input.clientId,
      secretChanged: Boolean(input.clientSecret),
      enabled: input.enabled,
      required: values.required,
    }
  )
}

/* ---------- the platform: which domains a college may sign in ---------- */

export const ssoDomainsSchema = z.object({
  domains: z.array(z.string().max(253)).max(20),
})

export async function setSsoDomains(
  actor: User,
  orgId: string,
  domains: string[]
) {
  const db = getDb()
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  if (!org) throw notFound("Organization not found")
  const clean = [
    ...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean)),
  ]
  for (const d of clean) {
    const problem = ssoDomainProblem(d)
    if (problem) throw new ApiError(400, "bad_domain", problem)
  }
  // One college per domain: two can't both sign in the same addresses.
  // A handful of rows at most (colleges with SSO), so compared here, not in SQL.
  const others = clean.length
    ? await db
        .select({ orgId: orgSso.orgId, domains: orgSso.domains })
        .from(orgSso)
    : []
  const taken = others.filter(
    (o) => o.orgId !== orgId && o.domains.some((d) => clean.includes(d))
  )
  if (taken.length)
    throw new ApiError(
      409,
      "domain_taken",
      "Another organization already signs in one of those domains."
    )
  await db
    .insert(orgSso)
    .values({ orgId, domains: clean, enabled: false })
    .onConflictDoUpdate({
      target: orgSso.orgId,
      // Taking every domain away switches it off.
      set: {
        domains: clean,
        ...(clean.length ? {} : { enabled: false, required: false }),
      },
    })
  await writePlatformAudit(
    actor,
    "platform.org_sso_domains",
    `Set ${org.name}'s single sign-on domains`,
    { org: orgId, domains: clean }
  )
  return { domains: clean }
}

export async function ssoDomainsOf(orgId: string) {
  const [row] = await getDb()
    .select({ domains: orgSso.domains, enabled: orgSso.enabled })
    .from(orgSso)
    .where(eq(orgSso.orgId, orgId))
  return { domains: row?.domains ?? [], enabled: row?.enabled ?? false }
}

/* ---------- signing in ---------- */

/** The college whose SSO is on for an email's domain, if any. */
export async function ssoFor(email: string) {
  const domain = emailDomain(email)
  if (!domain) return null
  const [row] = await getDb()
    .select({
      sso: orgSso,
      slug: organizations.slug,
      active: organizations.active,
    })
    .from(orgSso)
    .innerJoin(organizations, eq(orgSso.orgId, organizations.id))
    .where(
      and(eq(orgSso.enabled, true), sql.sql`${domain} = any(${orgSso.domains})`)
    )
  return row ?? null
}

/** Whether this address must sign in through its college (no password, no other Google). */
export async function ssoRequiredFor(
  email: string,
  provider?: "google" | "password"
) {
  const found = await ssoFor(email)
  if (!found?.sso.required) return false
  // A college whose identity provider is Google itself still signs in with Google.
  if (
    provider === "google" &&
    found.sso.issuer === "https://accounts.google.com"
  )
    return false
  return true
}

const safeNext = (next: string | null) =>
  next &&
  next.startsWith("/") &&
  !next.startsWith("//") &&
  !next.startsWith("/\\")
    ? next
    : "/home"

/** Step 1: remember a state, nonce and PKCE verifier, and send the browser to the IdP. */
export async function startSignIn(
  email: string,
  next: string | null,
  origin: string
) {
  const found = await ssoFor(email)
  if (!found || !found.active)
    throw new ApiError(
      404,
      "no_sso",
      "Your college hasn't set up single sign-on with GretLab. Sign in another way."
    )
  const state = random()
  const nonce = random()
  const verifier = random()
  await getDb()
    .insert(ssoStates)
    .values({
      state,
      orgId: found.sso.orgId,
      nonce,
      verifier,
      next: safeNext(next),
      expiresAt: new Date(Date.now() + STATE_MINUTES * 60_000),
    })
  const url = new URL(found.sso.authorizationEndpoint)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", found.sso.clientId)
  url.searchParams.set("redirect_uri", callbackUrl(origin))
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("nonce", nonce)
  url.searchParams.set(
    "code_challenge",
    createHash("sha256").update(verifier).digest("base64url")
  )
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("login_hint", email)
  return { redirect: url.toString(), state }
}

const keyCache = new Map<string, { keys: JsonWebKey[]; at: number }>()
async function idpKeys(jwksUri: string, refresh = false) {
  const cached = keyCache.get(jwksUri)
  if (cached && !refresh && Date.now() - cached.at < 5 * 60_000)
    return cached.keys
  const res = await fetch(jwksUri, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  })
  if (!res.ok)
    throw new ApiError(
      502,
      "idp_keys",
      "Couldn't get your college's keys to check the sign-in."
    )
  const body = (await res.json()) as { keys?: JsonWebKey[] }
  const keys = Array.isArray(body.keys) ? body.keys : []
  keyCache.set(jwksUri, { keys, at: Date.now() })
  return keys
}

/**
 * Step 2: the IdP sends the browser back with a code. The state is used once, within minutes,
 * by the browser that started it; the code is exchanged (with the PKCE verifier) for a signed
 * token, checked, and the person is signed in as a member of the college.
 */
export async function finishSignIn(input: {
  code: string
  state: string
  cookieState: string | null
  origin: string
}): Promise<{ user: User; redirect: string }> {
  const db = getDb()
  if (!input.cookieState || input.cookieState !== input.state)
    throw new ApiError(
      400,
      "bad_state",
      "This sign-in was started in another browser, or has expired. Try again."
    )
  const [used] = await db
    .update(ssoStates)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(ssoStates.state, input.state),
        isNull(ssoStates.usedAt),
        gt(ssoStates.expiresAt, new Date())
      )
    )
    .returning()
  if (!used)
    throw new ApiError(
      400,
      "bad_state",
      "This sign-in has expired or was already used. Try again."
    )
  const [config] = await db
    .select({ sso: orgSso, org: organizations })
    .from(orgSso)
    .innerJoin(organizations, eq(orgSso.orgId, organizations.id))
    .where(eq(orgSso.orgId, used.orgId))
  if (!config?.sso.enabled || !config.org.active)
    throw new ApiError(
      403,
      "no_sso",
      "Single sign-on isn't on for this college any more."
    )
  const secret = unseal(SEAL, config.sso.clientSecret)
  if (!secret)
    throw new ApiError(
      500,
      "no_secret",
      "Single sign-on isn't set up completely."
    )
  let tokens: { id_token?: unknown }
  try {
    const res = await fetch(config.sso.tokenEndpoint, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      redirect: "error",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: callbackUrl(input.origin),
        client_id: config.sso.clientId,
        client_secret: secret,
        code_verifier: used.verifier,
      }),
    })
    if (!res.ok) throw new Error(String(res.status))
    tokens = (await res.json()) as { id_token?: unknown }
  } catch {
    throw new ApiError(
      502,
      "token_exchange",
      "Your college's sign-in didn't complete. Try again."
    )
  }
  if (typeof tokens.id_token !== "string")
    throw new ApiError(
      502,
      "no_id_token",
      "Your college's sign-in didn't say who you are."
    )
  let claims = verifyJwt(tokens.id_token, await idpKeys(config.sso.jwksUri))
  // The IdP may have rotated its keys since we kept them.
  if (!claims)
    claims = verifyJwt(tokens.id_token, await idpKeys(config.sso.jwksUri, true))
  if (!claims)
    throw new ApiError(
      400,
      "bad_signature",
      "The sign-in's signature doesn't match your college's keys."
    )
  const who = checkIdToken(claims, {
    issuer: config.sso.issuer,
    clientId: config.sso.clientId,
    nonce: used.nonce,
    domains: config.sso.domains,
    now: Math.floor(Date.now() / 1000),
  })
  if ("error" in who) throw new ApiError(400, "bad_token", who.error)
  const user = await personFor(config.org.id, who)
  await writeAuditFor(
    config.org.id,
    user,
    `Signed in through ${config.org.name}'s single sign-on`
  )
  return { user, redirect: used.next }
}

/** The account the IdP vouches for: linked before, or by email (made if new), and a member. */
async function personFor(
  orgId: string,
  who: { sub: string; email: string; name: string | null }
) {
  const db = getDb()
  const [linked] = await db
    .select({ user: users })
    .from(ssoUsers)
    .innerJoin(users, eq(ssoUsers.userId, users.id))
    .where(and(eq(ssoUsers.orgId, orgId), eq(ssoUsers.sub, who.sub)))
  let user = linked?.user
  if (!user) {
    ;[user] = await db.select().from(users).where(eq(users.email, who.email))
    if (!user) {
      ;[user] = await db
        .insert(users)
        .values({
          email: who.email,
          name: who.name,
          handle: await freeHandle(who.email),
          role: "student",
        })
        .onConflictDoNothing({ target: users.email })
        .returning()
      user ??= (
        await db.select().from(users).where(eq(users.email, who.email))
      )[0]
    }
    await db
      .insert(ssoUsers)
      .values({ orgId, sub: who.sub, userId: user!.id })
      .onConflictDoNothing()
  }
  if (!user || user.disabled)
    throw new ApiError(403, "blocked", "This account is blocked.")
  // Someone new to the organization needs room in its plan (billing).
  const [member] = await db
    .select({ status: orgMembers.status })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)))
  if (member?.status !== "active") await needRoom(orgId, { members: 1 })
  await db
    .insert(orgMembers)
    .values({ orgId, userId: user.id, status: "active", joinedVia: "sso" })
    .onConflictDoUpdate({
      target: [orgMembers.orgId, orgMembers.userId],
      // Someone waiting for approval is let in by their college; nobody else changes.
      set: {
        status: sql.sql`case when ${orgMembers.status} = 'pending' then 'active'::membership_status else ${orgMembers.status} end`,
      },
    })
  return user
}

async function writeAuditFor(orgId: string, user: User, summary: string) {
  await writeEntry(getDb(), {
    orgId,
    actor: user,
    action: "sso.sign_in",
    summary,
  })
}
