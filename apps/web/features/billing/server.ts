import {
  getDb,
  organizations,
  orgMembers,
  orgRoles,
  payments,
  roleAssignments,
  sql,
  subscriptions,
  type User,
} from "@workspace/db"
import {
  BILLING_PERIODS,
  DEFAULT_FEATURES,
  DEFAULT_PRICE_LIST,
  PLAN_PRESETS,
  priceOfPlan,
  validGstin,
  withNeeds,
  type BillingPeriod,
  type PlanChoice,
  type PriceList,
} from "@workspace/judge"
import { z } from "zod"

import { rolePermissions } from "@/features/orgs/access"
import { needFor, orgContext, writeAudit } from "@/features/orgs/server"
import { platformCan } from "@/features/platform/access"
import { writePlatformAudit } from "@/features/platform/staff"
import { getSettings, updateSettings } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/route"
import { likeTerm, paged, type PageQuery } from "@/lib/api/paging"

/*
 * Plans and billing (AGENTS.md › Plans and billing; rules in packages/judge/src/billing.ts).
 * An organization's plan is its subscriptions row; the features are mirrored on
 * organizations.plan_features, which the module rules and needPlan read. Prices come from the
 * Billing settings over the launch price list. Paying (Razorpay) comes in features/billing/pay.ts.
 */

const { and, eq, exists, ilike, inArray, or, desc, count } = sql

/** The price list in force: the Billing settings over the launch prices. */
export async function priceList(): Promise<PriceList> {
  const s = await getSettings()
  const prices = s["billing.prices"]
  return {
    features: DEFAULT_PRICE_LIST.features.map((f) => ({
      ...f,
      price: prices[f.key] ?? f.price,
    })),
    staffPrice: s["billing.staff_price"],
    freeStaffPer: s["billing.free_staff_per"],
    steps: s["billing.steps"],
    periods: {
      year: 0,
      semester: s["billing.semester_percent"],
      month: s["billing.month_percent"],
    },
    quoteAbove: s["billing.quote_above"],
    judgePrice: s["billing.judge_price"],
    storagePrice: s["billing.storage_price"],
  }
}

/** What the page shows about each feature: its name, what it gives, its group, its price. */
async function catalogue() {
  const list = await priceList()
  const price = new Map(list.features.map((f) => [f.key, f.price]))
  return {
    list,
    features: DEFAULT_FEATURES.map((f) => ({
      key: f.key,
      name: f.name,
      what: f.what,
      group: f.group,
      price: price.get(f.key) ?? f.price,
      always: Boolean(f.always),
      needs: f.needs ?? [],
    })),
    presets: PLAN_PRESETS.map((p) => ({ ...p, features: [...p.features] })),
  }
}

/** Students (active members holding no permissions, seated in a group) and staff (any role that grants something). */
export async function usageOf(orgId: string) {
  const db = getDb()
  const roles = await db
    .select({
      id: orgRoles.id,
      systemKey: orgRoles.systemKey,
      permissions: orgRoles.permissions,
    })
    .from(orgRoles)
    .where(eq(orgRoles.orgId, orgId))
  const granting = roles
    .filter((r) => rolePermissions(r).length > 0)
    .map((r) => r.id)
  const isStaff = granting.length
    ? exists(
        db
          .select({ x: sql.sql`1` })
          .from(roleAssignments)
          .where(
            and(
              eq(roleAssignments.orgId, orgId),
              eq(roleAssignments.userId, orgMembers.userId),
              inArray(roleAssignments.roleId, granting)
            )
          )
      )
    : sql.sql`false`
  const [row] = await db
    .select({
      staff: count(sql.sql`case when ${isStaff} then 1 end`),
      students: count(
        sql.sql`case when not ${isStaff} and exists (
          select 1 from group_members gm join org_groups g on g.id = gm.group_id
          where gm.user_id = ${orgMembers.userId} and g.org_id = ${orgId}) then 1 end`
      ),
    })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.status, "active")))
  return {
    students: Number(row?.students ?? 0),
    staff: Number(row?.staff ?? 0),
  }
}

async function subscriptionOf(orgId: string) {
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
  return row ?? null
}

/** The plan as a choice the builder starts from. */
function choiceOf(
  sub: NonNullable<Awaited<ReturnType<typeof subscriptionOf>>>
): PlanChoice {
  return {
    features: sub.features,
    students: sub.students,
    staff: sub.staff,
    judges: sub.judges,
    storagePacks: sub.storagePacks,
    period: sub.period,
  }
}

/* ---------- the organization's side: Manage › Plan and billing ---------- */

async function billingContext(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needFor(ctx, "org.billing.manage", [])
  return ctx
}

export async function orgBilling(slug: string, user: User) {
  const ctx = await billingContext(slug, user)
  const [settings, sub, usage, cat, recent] = await Promise.all([
    getSettings(),
    subscriptionOf(ctx.org.id),
    usageOf(ctx.org.id),
    catalogue(),
    getDb()
      .select({
        id: payments.id,
        kind: payments.kind,
        total: payments.total,
        status: payments.status,
        invoiceNumber: payments.invoiceNumber,
        createdAt: payments.createdAt,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .where(eq(payments.orgId, ctx.org.id))
      .orderBy(desc(payments.createdAt))
      .limit(50),
  ])
  const current = sub ? choiceOf(sub) : null
  return {
    enabled: settings["billing.enabled"],
    /** Whether the organization can pay online (Razorpay set up on this server). */
    canPay: Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ),
    plan: sub
      ? {
          status: sub.status,
          period: sub.period,
          features:
            sub.status === "custom" && !ctx.org.planFeatures
              ? null
              : sub.features,
          students: sub.students,
          staff: sub.staff,
          judges: sub.judges,
          storagePacks: sub.storagePacks,
          periodStart: sub.periodStart,
          periodEnd: sub.periodEnd,
          price: sub.price,
          discountPercent: sub.discountPercent,
          next: sub.next,
          overSince: sub.overSince,
        }
      : null,
    /** What the current plan costs at today's prices (for comparing changes). */
    priceNow: current ? priceOfPlan(cat.list, current) : null,
    usage,
    billing: {
      legalName: sub?.legalName ?? "",
      gstin: sub?.gstin ?? "",
      address: sub?.address ?? "",
      billingEmail: sub?.billingEmail ?? "",
    },
    payments: recent,
    catalogue: cat,
    free: {
      students: settings["billing.free_students"],
      staff: settings["billing.free_staff"],
    },
    gst: {
      registered: settings["billing.gst_registered"],
      rate: settings["billing.gst_rate"],
      sellerState: settings["billing.gstin"].slice(0, 2),
    },
  }
}

export const billingProfileSchema = z.object({
  legalName: z.string().trim().max(200),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .max(15)
    .refine(
      (v) => v === "" || validGstin(v),
      "That isn't a GSTIN (15 characters, like 27AAPFU0939F1ZV)."
    ),
  address: z.string().trim().max(500),
  billingEmail: z.union([z.literal(""), z.email().max(320)]),
})

export async function saveBillingProfile(
  slug: string,
  user: User,
  input: z.infer<typeof billingProfileSchema>
) {
  const ctx = await billingContext(slug, user)
  await getDb()
    .insert(subscriptions)
    .values({ orgId: ctx.org.id, status: "free", ...input })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: { ...input, updatedAt: new Date(), updatedBy: user.id },
    })
  await writeAudit(ctx, "billing.profile", "Changed the billing details", {
    gstin: input.gstin || null,
  })
  return orgBilling(slug, user)
}

/* ---------- the platform's side: Dashboard › Plans ---------- */

async function needPlans(user: User) {
  if (!(await platformCan(user, "platform.billing.manage")))
    throw new ApiError(
      403,
      "forbidden",
      "Managing plans and billing isn't part of your role."
    )
}

/** Every organization's plan, a page at a time, searched by name or address. */
export async function allPlans(user: User, view: PageQuery) {
  await needPlans(user)
  const db = getDb()
  const where = view.q
    ? or(
        ilike(organizations.name, likeTerm(view.q)),
        ilike(organizations.slug, likeTerm(view.q))
      )
    : undefined
  const page = await paged({
    page: view.page ?? 1,
    perPage: view.perPage ?? 50,
    count: async () =>
      (await db.select({ n: count() }).from(organizations).where(where))[0]
        ?.n ?? 0,
    rows: (limit, offset) =>
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          type: organizations.type,
          planFeatures: organizations.planFeatures,
          sub: subscriptions,
        })
        .from(organizations)
        .leftJoin(subscriptions, eq(subscriptions.orgId, organizations.id))
        .where(where)
        .orderBy(organizations.name)
        .limit(limit)
        .offset(offset),
  })
  const items = await Promise.all(
    page.items.map(async (o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      type: o.type,
      /** Null: no plan limits. */
      features: o.planFeatures ?? null,
      status: o.sub?.status ?? "custom",
      period: o.sub?.period ?? "year",
      students: o.sub?.students ?? 0,
      staff: o.sub?.staff ?? 0,
      judges: o.sub?.judges ?? 0,
      storagePacks: o.sub?.storagePacks ?? 0,
      price: o.sub?.price ?? 0,
      discountPercent: o.sub?.discountPercent ?? 0,
      periodStart: o.sub?.periodStart ?? null,
      periodEnd: o.sub?.periodEnd ?? null,
      notes: o.sub?.notes ?? "",
      usage: await usageOf(o.id),
    }))
  )
  const settings = await getSettings()
  return {
    ...page,
    items,
    organizations: items,
    enabled: settings["billing.enabled"],
    catalogue: await catalogue(),
  }
}

export const setPlanSchema = z.object({
  status: z.enum(["free", "active", "past_due", "paused", "custom"]),
  /** Null: no plan limits (everything, as before billing). */
  features: z.array(z.string().max(40)).max(60).nullable(),
  students: z.number().int().min(0).max(1_000_000),
  staff: z.number().int().min(0).max(100_000),
  judges: z.number().int().min(0).max(100),
  storagePacks: z.number().int().min(0).max(1000),
  period: z.enum(BILLING_PERIODS as [BillingPeriod, ...BillingPeriod[]]),
  periodStart: z.iso.datetime().nullable(),
  periodEnd: z.iso.datetime().nullable(),
  discountPercent: z.number().int().min(0).max(100),
  notes: z.string().trim().max(2000),
})

/** Sets an organization's plan by hand (custom deals, pilots, a payment taken outside). */
export async function setOrgPlan(
  user: User,
  orgId: string,
  input: z.infer<typeof setPlanSchema>
) {
  await needPlans(user)
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw notFound("Organization not found")
  const [org] = await getDb()
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  if (!org) throw notFound("Organization not found")
  const list = await priceList()
  const features = input.features ? withNeeds(list, input.features) : null
  const price = features
    ? Math.round(
        priceOfPlan(list, { ...input, features }).price *
          (1 - input.discountPercent / 100)
      )
    : 0
  const values = {
    status: input.status,
    period: input.period,
    features: features ?? [],
    students: input.students,
    staff: input.staff,
    judges: input.judges,
    storagePacks: input.storagePacks,
    periodStart: input.periodStart ? new Date(input.periodStart) : null,
    periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
    price,
    discountPercent: input.discountPercent,
    notes: input.notes,
    prices: list as unknown as Record<string, unknown>,
    updatedAt: new Date(),
    updatedBy: user.id,
  }
  await getDb().transaction(async (tx) => {
    await tx
      .insert(subscriptions)
      .values({ orgId, ...values })
      .onConflictDoUpdate({ target: subscriptions.orgId, set: values })
    await tx
      .update(organizations)
      .set({ planFeatures: features })
      .where(eq(organizations.id, orgId))
  })
  await writePlatformAudit(
    user,
    "billing.set_plan",
    `Set ${org.name}'s plan: ${features ? `${features.length} features, ${input.students} students` : "no limits"} (${input.status})`,
    { orgId, ...input, features }
  )
  return { ok: true, price }
}

/** The Billing settings (prices and rules), for Dashboard › Plans. */
export async function billingSettings(user: User) {
  await needPlans(user)
  const s = await getSettings()
  return Object.fromEntries(
    Object.entries(s).filter(([key]) => key.startsWith("billing."))
  )
}

export async function saveBillingSettings(
  user: User,
  changes: Record<string, unknown>
) {
  await needPlans(user)
  for (const key of Object.keys(changes))
    if (!key.startsWith("billing."))
      throw new ApiError(
        400,
        "unknown_setting",
        `Not a billing setting: ${key}`
      )
  if (
    typeof changes["billing.gstin"] === "string" &&
    changes["billing.gstin"] !== "" &&
    !validGstin(changes["billing.gstin"])
  )
    throw new ApiError(400, "invalid_setting", "That isn't a GSTIN.")
  await updateSettings(changes)
  await writePlatformAudit(
    user,
    "billing.settings",
    "Changed billing prices or rules",
    {
      keys: Object.keys(changes),
    }
  )
  return billingSettings(user)
}
