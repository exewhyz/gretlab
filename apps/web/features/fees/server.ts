import {
  academicYears,
  feeHeads,
  feePayments,
  feePlans,
  getDb,
  organizations,
  sql,
  type User,
} from "@workspace/db"
import { planProblem, type Permission } from "@workspace/judge"
import { z } from "zod"

import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { seal } from "@/lib/sealed"
import { ApiError, notFound } from "@/lib/api/route"
import { editedElsewhere, unchangedSince } from "@/lib/api/conflict"

import type { feeHeadSchema, feePlanSchema, feeSettingsSchema } from "./schemas"

/*
 * Fees students pay their institution (the finance module; rules in packages/judge/src/fees.ts).
 * "Set up fees" (organization-wide) keeps the fee heads, each year's plans and the settings:
 * the receipt prefix, the GSTIN on receipts, and the institution's own Razorpay keys (sealed,
 * purpose "fees"; the secrets are never sent back). Collecting, concessions and the reports
 * are scoped to the students' groups.
 */

const { and, asc, count, eq, sql: raw } = { ...sql, sql: sql.sql }

export function needFees(ctx: OrgContext) {
  if (!ctx.modules.has("finance"))
    throw notFound("Fees aren't switched on for this organization.")
}

const forbidden = (what: string) =>
  new ApiError(403, "forbidden", `${what} isn't part of your role.`)

/** Organization-wide: setup needs it across the whole organization. */
function needSetup(ctx: OrgContext) {
  if (!canFor(ctx, "fees.setup", [])) throw forbidden("Setting up fees")
}

/** Any fee permission anywhere: who may open the Fees area at all. */
export function feeRights(ctx: OrgContext) {
  const any = (p: Permission) =>
    canFor(ctx, p, []) || ctx.groups.some((g) => canFor(ctx, p, [[g.id]]))
  return {
    setup: canFor(ctx, "fees.setup", []),
    collect: any("fees.collect"),
    concede: any("fees.concede"),
    view: any("fees.view") || any("fees.collect") || any("fees.concede"),
  }
}

type Settings = (typeof organizations.$inferSelect)["feeSettings"]

/** What the screen may know of the settings: never the secrets, only whether they're set. */
function publicSettings(s: Settings) {
  return {
    prefix: s.prefix ?? "",
    gstin: s.gstin ?? "",
    razorpay: s.razorpay
      ? { keyId: s.razorpay.keyId, secretsSet: true as const }
      : null,
  }
}

/** The Setup screen: heads, years with their plans, and the settings. */
export async function feeSetup(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const rights = feeRights(ctx)
  if (!rights.setup && !rights.view) throw forbidden("Fees")
  const db = getDb()
  const [heads, years, plans, paid] = await Promise.all([
    db
      .select()
      .from(feeHeads)
      .where(eq(feeHeads.orgId, ctx.org.id))
      .orderBy(asc(feeHeads.position), asc(feeHeads.name)),
    db
      .select({
        id: academicYears.id,
        name: academicYears.name,
        isCurrent: academicYears.isCurrent,
        startsOn: academicYears.startsOn,
      })
      .from(academicYears)
      .where(eq(academicYears.orgId, ctx.org.id))
      .orderBy(asc(academicYears.startsOn)),
    db
      .select()
      .from(feePlans)
      .where(eq(feePlans.orgId, ctx.org.id))
      .orderBy(asc(feePlans.name)),
    db
      .select({ planId: feePayments.planId, n: count() })
      .from(feePayments)
      .where(
        and(eq(feePayments.orgId, ctx.org.id), eq(feePayments.status, "paid"))
      )
      .groupBy(feePayments.planId),
  ])
  const payments = new Map(paid.map((p) => [p.planId, Number(p.n)]))
  return {
    can: rights,
    heads,
    years,
    plans: plans.map((p) => ({ ...p, payments: payments.get(p.id) ?? 0 })),
    settings: publicSettings(ctx.org.feeSettings),
  }
}

/* ---------- heads ---------- */

async function headInUse(orgId: string, headId: string) {
  const [row] = await getDb()
    .select({ id: feePlans.id })
    .from(feePlans)
    .where(
      and(
        eq(feePlans.orgId, orgId),
        raw`exists (select 1 from jsonb_array_elements(${feePlans.instalments}) i, jsonb_array_elements(i->'lines') l where l->>'headId' = ${headId})`
      )
    )
    .limit(1)
  return Boolean(row)
}

export async function saveHead(
  slug: string,
  user: User,
  id: string | null,
  input: z.infer<typeof feeHeadSchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  needSetup(ctx)
  const db = getDb()
  try {
    if (id) {
      const [row] = await db
        .update(feeHeads)
        .set(input)
        .where(and(eq(feeHeads.id, id), eq(feeHeads.orgId, ctx.org.id)))
        .returning()
      if (!row) throw notFound("No such fee head.")
      await writeAudit(ctx, "fees.head", `Changed the fee head ${row.name}`)
      return row
    }
    const [{ n }] = (await db
      .select({ n: count() })
      .from(feeHeads)
      .where(eq(feeHeads.orgId, ctx.org.id))) as [{ n: number }]
    const [row] = await db
      .insert(feeHeads)
      .values({ orgId: ctx.org.id, ...input, position: Number(n) })
      .returning()
    await writeAudit(ctx, "fees.head", `Added the fee head ${row!.name}`)
    return row!
  } catch (error) {
    // Drizzle wraps Postgres's error: its code is on the cause.
    const e = error as { code?: string; cause?: { code?: string } }
    if ((e.cause?.code ?? e.code) === "23505")
      throw new ApiError(
        409,
        "head_taken",
        "There's already a fee head with that name."
      )
    throw error
  }
}

export async function deleteHead(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  needSetup(ctx)
  if (await headInUse(ctx.org.id, id))
    throw new ApiError(
      409,
      "head_in_use",
      "A fee plan uses this head. Take it out of the plans first."
    )
  const [row] = await getDb()
    .delete(feeHeads)
    .where(and(eq(feeHeads.id, id), eq(feeHeads.orgId, ctx.org.id)))
    .returning({ name: feeHeads.name })
  if (!row) throw notFound("No such fee head.")
  await writeAudit(ctx, "fees.head", `Removed the fee head ${row.name}`)
}

/* ---------- plans ---------- */

export async function savePlan(
  slug: string,
  user: User,
  id: string | null,
  input: z.infer<typeof feePlanSchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  needSetup(ctx)
  const db = getDb()
  const [year] = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(
      and(
        eq(academicYears.id, input.yearId),
        eq(academicYears.orgId, ctx.org.id)
      )
    )
  if (!year)
    throw new ApiError(
      400,
      "bad_year",
      "That academic year isn't one of yours."
    )
  const groupIds = new Set(ctx.groups.map((g) => g.id))
  if (input.audience.some((g) => !groupIds.has(g)))
    throw new ApiError(
      400,
      "bad_audience",
      "Choose classes of this organization."
    )
  const heads = await db
    .select({ id: feeHeads.id })
    .from(feeHeads)
    .where(eq(feeHeads.orgId, ctx.org.id))
  const problem = planProblem(
    input.instalments,
    heads.map((h) => h.id)
  )
  if (problem) throw new ApiError(400, "bad_plan", problem)
  const values = {
    yearId: input.yearId,
    name: input.name,
    audience: [...new Set(input.audience)],
    instalments: input.instalments.map((i) => ({
      ...i,
      label: i.label.trim(),
    })),
    updatedAt: new Date(),
  }
  if (id) {
    const [row] = await db
      .update(feePlans)
      .set(values)
      .where(
        and(
          eq(feePlans.id, id),
          eq(feePlans.orgId, ctx.org.id),
          unchangedSince(
            feePlans.updatedAt,
            input.expectedUpdatedAt ?? undefined
          )
        )
      )
      .returning()
    if (!row) {
      const [exists] = await db
        .select({ id: feePlans.id })
        .from(feePlans)
        .where(and(eq(feePlans.id, id), eq(feePlans.orgId, ctx.org.id)))
      throw exists ? editedElsewhere() : notFound("No such fee plan.")
    }
    await writeAudit(ctx, "fees.plan", `Changed the fee plan ${row!.name}`)
    return row!
  }
  const [row] = await db
    .insert(feePlans)
    .values({ orgId: ctx.org.id, ...values })
    .returning()
  await writeAudit(ctx, "fees.plan", `Made the fee plan ${row!.name}`)
  return row!
}

export async function deletePlan(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  needSetup(ctx)
  const db = getDb()
  const [{ n }] = (await db
    .select({ n: count() })
    .from(feePayments)
    .where(
      and(eq(feePayments.planId, id), eq(feePayments.orgId, ctx.org.id))
    )) as [{ n: number }]
  if (Number(n) > 0)
    throw new ApiError(
      409,
      "plan_has_payments",
      "Payments have been made on this plan, so it can't be deleted. Change it instead."
    )
  const [row] = await db
    .delete(feePlans)
    .where(and(eq(feePlans.id, id), eq(feePlans.orgId, ctx.org.id)))
    .returning({ name: feePlans.name })
  if (!row) throw notFound("No such fee plan.")
  await writeAudit(ctx, "fees.plan", `Deleted the fee plan ${row.name}`)
}

/* ---------- settings ---------- */

export async function saveFeeSettings(
  slug: string,
  user: User,
  input: z.infer<typeof feeSettingsSchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  needSetup(ctx)
  const before = ctx.org.feeSettings
  let razorpay = before.razorpay
  if (input.razorpay === null) razorpay = undefined
  else if (input.razorpay) {
    const { keyId, keySecret, webhookSecret } = input.razorpay
    if (!/^rzp_(test|live)_[A-Za-z0-9]{6,}$/.test(keyId))
      throw new ApiError(
        400,
        "bad_key",
        "A Razorpay key ID starts rzp_live_ or rzp_test_."
      )
    // An empty secret keeps the one already saved.
    const keep = before.razorpay
    if ((!keySecret && !keep) || (!webhookSecret && !keep))
      throw new ApiError(
        400,
        "bad_key",
        "Enter the key secret and the webhook secret."
      )
    razorpay = {
      keyId,
      keySecret: keySecret ? seal("fees", keySecret) : keep!.keySecret,
      webhookSecret: webhookSecret
        ? seal("fees", webhookSecret)
        : keep!.webhookSecret,
    }
  }
  const next = { prefix: input.prefix, gstin: input.gstin, razorpay }
  await getDb()
    .update(organizations)
    .set({ feeSettings: next })
    .where(eq(organizations.id, ctx.org.id))
  const changed: string[] = []
  if ((before.prefix ?? "") !== input.prefix) changed.push("receipt prefix")
  if ((before.gstin ?? "") !== input.gstin) changed.push("GSTIN")
  if (Boolean(before.razorpay) !== Boolean(razorpay) || input.razorpay)
    changed.push("online payments")
  await writeAudit(
    ctx,
    "fees.settings",
    `Changed the fee settings${changed.length ? `: ${changed.join(", ")}` : ""}`
  )
  return publicSettings(next)
}
