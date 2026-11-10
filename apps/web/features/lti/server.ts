import { randomBytes, type JsonWebKey } from "node:crypto"

import {
  assignments,
  getDb,
  groupMembers,
  ltiContexts,
  ltiDeepLinks,
  ltiLinks,
  ltiPlatforms,
  ltiStates,
  ltiUsers,
  orgGroups,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  sql,
  users,
  type User,
} from "@workspace/db"
import { checkLaunch, isInstructor, LTI, scoresUrl } from "@workspace/judge"

import { getGradebook } from "@/features/assignments/server"
import { freeHandle } from "@/features/catalog/server"
import { ApiError, notFound } from "@/lib/api/route"

import { decodeJwt, signJwt, toolKey, verifyJwt } from "./jwt"

/*
 * LTI 1.3 for organizations: an LMS course opens Gretlab with the person signed in, placed
 * in the class an admin linked to that course, and taken to the assignment the link is
 * for; teachers add assignments to their course (deep linking); grades go back to the
 * LMS's gradebook (Assignment and Grade Services). Launch checks: packages/judge lti.ts.
 */

const { and, eq, gt, inArray, isNull } = sql

const STATE_MINUTES = 10

/** Where Gretlab is reached, for the addresses an LMS calls back. */
export const siteOrigin = (fallback: string) => process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? fallback

/** LMS addresses must be https in production (http for local testing only). */
export function checkLmsUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const httpOk = process.env.NODE_ENV !== "production" || process.env.LTI_ALLOW_HTTP === "true"
  return url.protocol === "https:" || (httpOk && url.protocol === "http:")
}

const random = () => randomBytes(24).toString("base64url")

/* ---------- the LMS's keys ---------- */

const keyCache = new Map<string, { keys: JsonWebKey[]; at: number }>()

async function platformKeys(jwksUrl: string, refresh = false) {
  const cached = keyCache.get(jwksUrl)
  if (cached && !refresh && Date.now() - cached.at < 5 * 60_000) return cached.keys
  const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000), redirect: "error" })
  if (!res.ok) throw new ApiError(502, "lms_keys", "Couldn't get the LMS's keys to check the launch.")
  const body = (await res.json()) as { keys?: JsonWebKey[] }
  const keys = Array.isArray(body.keys) ? body.keys : []
  keyCache.set(jwksUrl, { keys, at: Date.now() })
  return keys
}

/* ---------- step 1: the LMS starts a sign-in ---------- */

/**
 * OIDC login initiation: the LMS sends who's coming; we remember a state and nonce and
 * send the browser to the LMS's authorization endpoint, which posts the launch back.
 */
export async function loginInit(params: URLSearchParams, origin: string) {
  const iss = params.get("iss") ?? ""
  const clientId = params.get("client_id")
  const loginHint = params.get("login_hint")
  if (!iss || !loginHint) throw new ApiError(400, "bad_login", "The LMS's sign-in request is missing its issuer or user.")
  const candidates = await getDb()
    .select()
    .from(ltiPlatforms)
    .where(and(eq(ltiPlatforms.issuer, iss), clientId ? eq(ltiPlatforms.clientId, clientId) : undefined))
  if (candidates.length !== 1) {
    throw new ApiError(400, "unknown_lms", "This LMS isn't registered with Gretlab (or it didn't say which registration).")
  }
  const platform = candidates[0]!
  const state = random()
  const nonce = random()
  await getDb()
    .insert(ltiStates)
    .values({ state, nonce, platformId: platform.id, expiresAt: new Date(Date.now() + STATE_MINUTES * 60_000) })
  const target = new URL(platform.authUrl)
  const query = {
    scope: "openid",
    response_type: "id_token",
    response_mode: "form_post",
    prompt: "none",
    client_id: platform.clientId,
    redirect_uri: `${siteOrigin(origin)}/api/v1/lti/launch`,
    login_hint: loginHint,
    state,
    nonce,
    ...(params.get("lti_message_hint") ? { lti_message_hint: params.get("lti_message_hint")! } : {}),
  }
  for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v)
  return { redirect: target.toString(), state }
}

/* ---------- step 2: the launch ---------- */

export interface LaunchResult {
  user: User
  redirect: string
}

/**
 * Checks a launch (state once, signature, claims) and signs the person in: their account
 * (matched by LMS id, then email), membership, class and role, and where to go.
 */
export async function launch(idToken: string, state: string, cookieState: string | null): Promise<LaunchResult> {
  const db = getDb()
  // The state is used once, within minutes; over https the browser must also carry it.
  const [used] = await db
    .update(ltiStates)
    .set({ usedAt: new Date() })
    .where(and(eq(ltiStates.state, state), isNull(ltiStates.usedAt), gt(ltiStates.expiresAt, new Date())))
    .returning()
  if (!used) throw new ApiError(400, "bad_state", "This launch has expired or was already used. Open it again from your course.")
  if (cookieState !== null && cookieState !== state) throw new ApiError(400, "bad_state", "This launch was started in another browser.")
  const [platform] = await db.select().from(ltiPlatforms).where(eq(ltiPlatforms.id, used.platformId))
  if (!platform) throw notFound("Not found")
  const decoded = decodeJwt(idToken)
  if (!decoded) throw new ApiError(400, "bad_token", "The launch isn't a valid LTI message.")
  let claims = verifyJwt(idToken, await platformKeys(platform.jwksUrl))
  // The LMS may have rotated its keys since we cached them.
  if (!claims) claims = verifyJwt(idToken, await platformKeys(platform.jwksUrl, true))
  if (!claims) throw new ApiError(400, "bad_signature", "The launch's signature doesn't match the LMS's keys.")
  const checked = checkLaunch(claims, {
    issuer: platform.issuer,
    clientId: platform.clientId,
    deploymentIds: platform.deploymentIds,
    nonce: used.nonce,
    now: Math.floor(Date.now() / 1000),
  })
  if ("error" in checked) throw new ApiError(400, "bad_launch", checked.error)

  const [org] = await db.select().from(organizations).where(eq(organizations.id, platform.orgId))
  if (!org?.active) throw new ApiError(403, "suspended", "This organization is suspended.")
  const user = await personFor(platform.id, org.id, claims)
  const teacher = isInstructor(claims[LTI.roles])
  const contextClaim = claims[LTI.context] as { id?: string; title?: string; label?: string } | undefined
  const context = contextClaim?.id ? await contextFor(platform.id, contextClaim.id, contextClaim.title ?? contextClaim.label ?? "") : null
  if (context?.groupId) await placeInClass(org.id, context.groupId, user.id, teacher)

  if (checked.kind === "deep_link") {
    if (!teacher) throw new ApiError(403, "not_instructor", "Only teachers add Gretlab assignments to a course.")
    const settings = claims[LTI.deepLinking] as { deep_link_return_url: string; data?: string }
    const [row] = await db
      .insert(ltiDeepLinks)
      .values({
        platformId: platform.id,
        userId: user.id,
        deploymentId: claims[LTI.deploymentId] as string,
        returnUrl: settings.deep_link_return_url,
        data: settings.data ?? null,
        contextId: context?.id ?? null,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .returning()
    return { user, redirect: `/lti/pick/${row!.id}` }
  }

  // A resource link: remember it (and where its scores go), and open its assignment.
  const link = claims[LTI.resourceLink] as { id: string; title?: string }
  const ags = claims[LTI.ags] as { lineitem?: string; scope?: string[] } | undefined
  const assignmentId = await assignmentFor(org.id, claims)
  const [saved] = await db
    .insert(ltiLinks)
    .values({
      platformId: platform.id,
      resourceLinkId: link.id,
      contextId: context?.id ?? null,
      assignmentId,
      lineItemUrl: ags?.lineitem && checkLmsUrl(ags.lineitem) ? ags.lineitem : null,
      title: link.title ?? "",
    })
    .onConflictDoUpdate({
      target: [ltiLinks.platformId, ltiLinks.resourceLinkId],
      set: {
        contextId: context?.id ?? null,
        ...(assignmentId ? { assignmentId } : {}),
        ...(ags?.lineitem && checkLmsUrl(ags.lineitem) ? { lineItemUrl: ags.lineitem } : {}),
        title: link.title ?? "",
      },
    })
    .returning()
  if (saved?.assignmentId) {
    const [a] = await db.select({ slug: assignments.slug }).from(assignments).where(eq(assignments.id, saved.assignmentId))
    if (a) return { user, redirect: `/assignments/${a.slug}` }
  }
  if (context?.groupId) return { user, redirect: `/orgs/${org.slug}/classes/${context.groupId}` }
  return { user, redirect: `/lti/unlinked?org=${encodeURIComponent(org.slug)}` }
}

/** The account for an LMS user: linked before, or by email (made if new), and a member. */
async function personFor(platformId: string, orgId: string, claims: Record<string, unknown>) {
  const db = getDb()
  const sub = claims.sub as string
  const [linked] = await db
    .select({ user: users })
    .from(ltiUsers)
    .innerJoin(users, eq(ltiUsers.userId, users.id))
    .where(and(eq(ltiUsers.platformId, platformId), eq(ltiUsers.sub, sub)))
  let user = linked?.user
  if (!user) {
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : ""
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(400, "no_email", "Your LMS didn't share your email address, which Gretlab needs. Ask your admin to share it with this tool.")
    }
    const name = typeof claims.name === "string" ? claims.name : [claims.given_name, claims.family_name].filter((x) => typeof x === "string").join(" ") || null
    ;[user] = await db.select().from(users).where(eq(users.email, email))
    if (!user) {
      ;[user] = await db
        .insert(users)
        .values({ email, name, handle: await freeHandle(email), role: "student" })
        .onConflictDoNothing({ target: users.email })
        .returning()
      user ??= (await db.select().from(users).where(eq(users.email, email)))[0]
    }
    await db.insert(ltiUsers).values({ platformId, sub, userId: user!.id }).onConflictDoNothing()
  }
  if (!user || user.disabled) throw new ApiError(403, "blocked", "This account is blocked.")
  await db
    .insert(orgMembers)
    .values({ orgId, userId: user.id, status: "active", joinedVia: "lti" })
    .onConflictDoUpdate({
      target: [orgMembers.orgId, orgMembers.userId],
      // Someone waiting for approval is let in by their course; nobody else changes.
      set: { status: sql.sql`case when ${orgMembers.status} = 'pending' then 'active'::membership_status else ${orgMembers.status} end` },
    })
  return user
}

async function contextFor(platformId: string, contextId: string, title: string) {
  const [row] = await getDb()
    .insert(ltiContexts)
    .values({ platformId, contextId, title })
    .onConflictDoUpdate({ target: [ltiContexts.platformId, ltiContexts.contextId], set: { title } })
    .returning()
  return row!
}

/**
 * Puts a learner in the linked class (its last-level groups, as everywhere), or gives an
 * instructor the built-in Teacher role for it.
 */
async function placeInClass(orgId: string, groupId: string, userId: string, teacher: boolean) {
  const db = getDb()
  if (teacher) {
    const [role] = await db
      .select({ id: orgRoles.id })
      .from(orgRoles)
      .where(and(eq(orgRoles.orgId, orgId), eq(orgRoles.systemKey, "teacher")))
    if (!role) return
    const [has] = await db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.roleId, role.id), eq(roleAssignments.groupId, groupId)))
    if (!has) await db.insert(roleAssignments).values({ orgId, userId, roleId: role.id, groupId })
    return
  }
  const groups = await db.select({ id: orgGroups.id, parentId: orgGroups.parentId }).from(orgGroups).where(eq(orgGroups.orgId, orgId))
  const inside = (id: string): string[] => {
    const kids = groups.filter((g) => g.parentId === id)
    return kids.length ? kids.flatMap((k) => inside(k.id)) : [id]
  }
  const leaves = inside(groupId)
  await db
    .insert(groupMembers)
    .values(leaves.map((g) => ({ groupId: g, userId })))
    .onConflictDoNothing()
}

/** The assignment a link opens: a `assignment` custom value or an /assignments/<slug> target. */
async function assignmentFor(orgId: string, claims: Record<string, unknown>) {
  const custom = claims[LTI.custom] as Record<string, unknown> | undefined
  let slug = typeof custom?.assignment === "string" ? custom.assignment : null
  const target = claims[LTI.targetLinkUri]
  if (!slug && typeof target === "string") {
    const m = /\/assignments\/([a-z0-9-]+)\/?$/.exec(new URL(target, "https://x").pathname)
    slug = m?.[1] ?? null
  }
  if (!slug) return null
  const [a] = await getDb()
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.slug, slug), eq(assignments.orgId, orgId)))
  return a?.id ?? null
}

/* ---------- deep linking ---------- */

async function deepLinkFor(user: User, id: string) {
  const [row] = await getDb()
    .select({ dl: ltiDeepLinks, platform: ltiPlatforms })
    .from(ltiDeepLinks)
    .innerJoin(ltiPlatforms, eq(ltiDeepLinks.platformId, ltiPlatforms.id))
    .where(and(eq(ltiDeepLinks.id, id), eq(ltiDeepLinks.userId, user.id)))
  if (!row || row.dl.usedAt || row.dl.expiresAt < new Date()) {
    throw notFound("This choice has expired. Start it again from your course.")
  }
  return row
}

/** What a teacher may add to their course: the organization's published assignments. */
export async function deepLinkChoices(user: User, id: string) {
  const { platform } = await deepLinkFor(user, id)
  const rows = await getDb()
    .select({ id: assignments.id, title: assignments.title, slug: assignments.slug, dueAt: assignments.dueAt })
    .from(assignments)
    .where(and(eq(assignments.orgId, platform.orgId), eq(assignments.published, true)))
    .orderBy(sql.desc(assignments.dueAt))
  return { lms: platform.name, assignments: rows }
}

/**
 * The deep linking response: a signed message for the LMS with the chosen assignment as a
 * link and a gradebook column for it. The browser posts it to the LMS.
 */
export async function deepLinkRespond(user: User, id: string, assignmentId: string, origin: string) {
  const { dl, platform } = await deepLinkFor(user, id)
  const [a] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.orgId, platform.orgId), eq(assignments.published, true)))
  if (!a) throw notFound("Assignment not found")
  const book = await getGradebook(a.id, platform.orgId)
  const key = await toolKey()
  const now = Math.floor(Date.now() / 1000)
  const jwt = signJwt(
    {
      iss: platform.clientId,
      aud: platform.issuer,
      iat: now,
      exp: now + 600,
      nonce: random(),
      [LTI.messageType]: "LtiDeepLinkingResponse",
      [LTI.version]: "1.3.0",
      [LTI.deploymentId]: dl.deploymentId,
      [LTI.contentItems]: [
        {
          type: "ltiResourceLink",
          title: a.title,
          url: `${siteOrigin(origin)}/assignments/${a.slug}`,
          custom: { assignment: a.slug },
          lineItem: { scoreMaximum: Math.max(book.total, 1), label: a.title, resourceId: a.id },
        },
      ],
      ...(dl.data ? { [LTI.dlData]: dl.data } : {}),
    },
    key.privateKey,
    key.kid
  )
  await getDb().update(ltiDeepLinks).set({ usedAt: new Date() }).where(eq(ltiDeepLinks.id, dl.id))
  return { returnUrl: dl.returnUrl, jwt }
}

/* ---------- grades back to the LMS ---------- */

/** An access token for the LMS's grade service, asked for with a signed assertion. */
async function scoreToken(platform: typeof ltiPlatforms.$inferSelect) {
  const key = await toolKey()
  const now = Math.floor(Date.now() / 1000)
  const assertion = signJwt(
    { iss: platform.clientId, sub: platform.clientId, aud: platform.tokenUrl, iat: now, exp: now + 300, jti: random() },
    key.privateKey,
    key.kid
  )
  const res = await fetch(platform.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
      scope: LTI.scoreScope,
    }),
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  })
  if (!res.ok) throw new ApiError(502, "lms_token", `${platform.name} refused Gretlab's request to send grades (${res.status}).`)
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new ApiError(502, "lms_token", `${platform.name} didn't give Gretlab a token to send grades.`)
  return body.access_token
}

/** Where an assignment's grades can go: its LMS links that have a gradebook column. */
export async function gradeTargets(assignmentId: string) {
  return getDb()
    .select({ link: ltiLinks, platform: ltiPlatforms })
    .from(ltiLinks)
    .innerJoin(ltiPlatforms, eq(ltiLinks.platformId, ltiPlatforms.id))
    .where(and(eq(ltiLinks.assignmentId, assignmentId), sql.isNotNull(ltiLinks.lineItemUrl)))
}

/** Sends every student's current total to each linked LMS gradebook column. */
export async function sendGrades(assignmentId: string, orgId: string, scope: "all" | Set<string>) {
  const targets = await gradeTargets(assignmentId)
  if (targets.length === 0) throw new ApiError(409, "not_linked", "No LMS course links to this assignment yet.")
  const book = await getGradebook(assignmentId, orgId, scope)
  const emails = book.rows.map((r) => r.email)
  const people = emails.length
    ? await getDb().select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, emails))
    : []
  let sent = 0
  let skipped = 0
  const failed: string[] = []
  for (const { link, platform } of targets) {
    const subs = people.length
      ? await getDb()
          .select({ sub: ltiUsers.sub, userId: ltiUsers.userId })
          .from(ltiUsers)
          .where(and(eq(ltiUsers.platformId, platform.id), inArray(ltiUsers.userId, people.map((p) => p.id))))
      : []
    const token = await scoreToken(platform)
    for (const row of book.rows) {
      const person = people.find((p) => p.email === row.email)
      const sub = subs.find((s) => s.userId === person?.id)?.sub
      // Only people who have come through this LMS have an id there.
      if (!sub) {
        skipped += 1
        continue
      }
      const res = await fetch(scoresUrl(link.lineItemUrl!), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/vnd.ims.lis.v1.score+json" },
        body: JSON.stringify({
          userId: sub,
          scoreGiven: row.earned,
          scoreMaximum: Math.max(book.total, 1),
          activityProgress: "Completed",
          gradingProgress: "FullyGraded",
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      }).catch(() => null)
      if (res?.ok) sent += 1
      else failed.push(row.email)
    }
  }
  return { sent, skipped, failed }
}

/* ---------- the organization's settings ---------- */

export async function platformsOf(orgId: string) {
  const db = getDb()
  const platforms = await db.select().from(ltiPlatforms).where(eq(ltiPlatforms.orgId, orgId)).orderBy(sql.asc(ltiPlatforms.name))
  const contexts = platforms.length
    ? await db
        .select()
        .from(ltiContexts)
        .where(inArray(ltiContexts.platformId, platforms.map((p) => p.id)))
        .orderBy(sql.asc(ltiContexts.title))
    : []
  return platforms.map((p) => ({ ...p, contexts: contexts.filter((c) => c.platformId === p.id) }))
}

export async function savePlatform(
  orgId: string,
  id: string | null,
  input: { name: string; issuer: string; clientId: string; deploymentIds: string[]; authUrl: string; tokenUrl: string; jwksUrl: string }
) {
  for (const [label, url] of [["Authentication", input.authUrl], ["Access token", input.tokenUrl], ["Keyset", input.jwksUrl]] as const) {
    if (!checkLmsUrl(url)) throw new ApiError(400, "bad_url", `${label} URL must be an https address.`)
  }
  const values = { ...input, deploymentIds: [...new Set(input.deploymentIds.map((d) => d.trim()).filter(Boolean))] }
  const db = getDb()
  try {
    if (!id) {
      const [row] = await db.insert(ltiPlatforms).values({ ...values, orgId }).returning()
      return row!
    }
    const [row] = await db
      .update(ltiPlatforms)
      .set(values)
      .where(and(eq(ltiPlatforms.id, id), eq(ltiPlatforms.orgId, orgId)))
      .returning()
    if (!row) throw notFound("Not found")
    keyCache.delete(row.jwksUrl)
    return row
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(409, "duplicate", "That LMS and client ID are already registered.")
  }
}

export async function deletePlatform(orgId: string, id: string) {
  const [row] = await getDb()
    .delete(ltiPlatforms)
    .where(and(eq(ltiPlatforms.id, id), eq(ltiPlatforms.orgId, orgId)))
    .returning()
  if (!row) throw notFound("Not found")
  return row
}

/** Links an LMS course to one of the organization's classes (or unlinks it). */
export async function linkContext(orgId: string, contextId: string, groupId: string | null) {
  const db = getDb()
  const [row] = await db
    .select({ c: ltiContexts })
    .from(ltiContexts)
    .innerJoin(ltiPlatforms, eq(ltiContexts.platformId, ltiPlatforms.id))
    .where(and(eq(ltiContexts.id, contextId), eq(ltiPlatforms.orgId, orgId)))
  if (!row) throw notFound("Not found")
  if (groupId) {
    const [g] = await db.select({ id: orgGroups.id }).from(orgGroups).where(and(eq(orgGroups.id, groupId), eq(orgGroups.orgId, orgId)))
    if (!g) throw notFound("Class not found")
  }
  await db.update(ltiContexts).set({ groupId }).where(eq(ltiContexts.id, contextId))
  return row.c
}
