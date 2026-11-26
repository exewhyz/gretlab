/**
 * A college proving it owns an email domain, so its single sign-on may sign in addresses on it
 * (the owner's decision, 26 November 2026: self-serve with DNS, as Google Workspace and
 * Microsoft 365 do). It adds a TXT record `_gretlab-challenge.<domain>` holding
 * `gretlab-verify=<token>`; Verify looks it up and, when it matches, adds the domain. Public mail
 * is refused, and a domain another organization verified can't be claimed. Platform staff can
 * still set domains by hand (setSsoDomains in ./server.ts).
 */
import { randomBytes } from "node:crypto"
import { Resolver } from "node:dns/promises"

import { getDb, orgSso, sql, ssoDomainClaims, type User } from "@workspace/db"
import { ssoDomainProblem } from "@workspace/judge"
import { z } from "zod"

import { need, orgContext, writeAudit } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

const { and, eq } = sql

export const RECORD_PREFIX = "_gretlab-challenge"
const valueOf = (token: string) => `gretlab-verify=${token}`

export const domainSchema = z.object({
  domain: z.string().trim().toLowerCase().max(253),
})

/** The college's verified domains and the ones waiting for their DNS record. */
export async function domainClaims(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  need(ctx, "org.settings.manage")
  const db = getDb()
  const [[sso], claims] = await Promise.all([
    db
      .select({ domains: orgSso.domains })
      .from(orgSso)
      .where(eq(orgSso.orgId, ctx.org.id)),
    db
      .select()
      .from(ssoDomainClaims)
      .where(eq(ssoDomainClaims.orgId, ctx.org.id)),
  ])
  const verified = sso?.domains ?? []
  return {
    verified,
    pending: claims
      .filter((c) => !verified.includes(c.domain))
      .map((c) => ({
        domain: c.domain,
        record: `${RECORD_PREFIX}.${c.domain}`,
        value: valueOf(c.token),
        since: c.createdAt,
      })),
  }
}

/** Another organization already signs in this domain. */
async function takenElsewhere(orgId: string, domain: string) {
  const rows = await getDb()
    .select({ orgId: orgSso.orgId, domains: orgSso.domains })
    .from(orgSso)
  return rows.some((r) => r.orgId !== orgId && r.domains.includes(domain))
}

/** Starts proving a domain: the record to add. Asking again keeps the same record. */
export async function claimDomain(slug: string, user: User, domain: string) {
  const ctx = await orgContext(slug, user)
  need(ctx, "org.settings.manage")
  const problem = ssoDomainProblem(domain)
  if (problem) throw new ApiError(400, "bad_domain", problem)
  if (await takenElsewhere(ctx.org.id, domain))
    throw new ApiError(
      409,
      "domain_taken",
      "Another organization already signs in that domain."
    )
  await getDb()
    .insert(ssoDomainClaims)
    .values({
      orgId: ctx.org.id,
      domain,
      token: randomBytes(18).toString("base64url"),
    })
    .onConflictDoNothing()
  await writeAudit(
    ctx,
    "org.sso_domain_claim",
    `Started verifying ${domain} for single sign-on`,
    { domain }
  )
  return domainClaims(slug, user)
}

/** The TXT records at a name, through SSO_DNS_SERVER when set (tests), else the system's. */
async function txtRecords(name: string) {
  const resolver = new Resolver({ timeout: 4000, tries: 2 })
  if (process.env.SSO_DNS_SERVER)
    resolver.setServers([process.env.SSO_DNS_SERVER])
  try {
    return (await resolver.resolveTxt(name)).map((chunks) => chunks.join(""))
  } catch {
    return []
  }
}

/** Looks the record up; when it matches, the domain is the college's. */
export async function verifyDomain(slug: string, user: User, domain: string) {
  const ctx = await orgContext(slug, user)
  need(ctx, "org.settings.manage")
  const db = getDb()
  const [claim] = await db
    .select()
    .from(ssoDomainClaims)
    .where(
      and(
        eq(ssoDomainClaims.orgId, ctx.org.id),
        eq(ssoDomainClaims.domain, domain)
      )
    )
  if (!claim) throw notFound("Add the domain first")
  const found = await txtRecords(`${RECORD_PREFIX}.${domain}`)
  if (!found.includes(valueOf(claim.token)))
    throw new ApiError(
      409,
      "not_found_yet",
      `The record isn't there yet. Add a TXT record named ${RECORD_PREFIX}.${domain} with the value shown; DNS changes can take a few minutes, sometimes longer.`
    )
  if (await takenElsewhere(ctx.org.id, domain))
    throw new ApiError(
      409,
      "domain_taken",
      "Another organization already signs in that domain."
    )
  await db.transaction(async (tx) => {
    await tx
      .update(ssoDomainClaims)
      .set({ verifiedAt: new Date() })
      .where(
        and(
          eq(ssoDomainClaims.orgId, ctx.org.id),
          eq(ssoDomainClaims.domain, domain)
        )
      )
    await tx
      .insert(orgSso)
      .values({ orgId: ctx.org.id, domains: [domain] })
      .onConflictDoUpdate({
        target: orgSso.orgId,
        set: {
          domains: sql.sql`array(select distinct unnest(${orgSso.domains} || array[${domain}]::text[]))`,
        },
      })
  })
  await writeAudit(
    ctx,
    "org.sso_domain_verify",
    `Verified ${domain} for single sign-on`,
    { domain }
  )
  return domainClaims(slug, user)
}

/** Takes a domain away (or a claim not yet verified). The last one switches sign-on off. */
export async function removeDomain(slug: string, user: User, domain: string) {
  const ctx = await orgContext(slug, user)
  need(ctx, "org.settings.manage")
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx
      .delete(ssoDomainClaims)
      .where(
        and(
          eq(ssoDomainClaims.orgId, ctx.org.id),
          eq(ssoDomainClaims.domain, domain)
        )
      )
    const [row] = await tx
      .select()
      .from(orgSso)
      .where(eq(orgSso.orgId, ctx.org.id))
    if (!row) return
    const domains = row.domains.filter((d) => d !== domain)
    await tx
      .update(orgSso)
      .set({
        domains,
        ...(domains.length ? {} : { enabled: false, required: false }),
      })
      .where(eq(orgSso.orgId, ctx.org.id))
  })
  await writeAudit(
    ctx,
    "org.sso_domain_remove",
    `Removed ${domain} from single sign-on`,
    { domain }
  )
  return domainClaims(slug, user)
}
