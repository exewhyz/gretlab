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

import { usageOf } from "./limits"
import { razorpayReady } from "./razorpay"
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
  const { limitsOf } = await import("./limits")
  const [settings, sub, usage, cat, recent, limits] = await Promise.all([
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
    limitsOf(ctx.org.id),
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
    /** Against the plan: fine, near (90%), over (with grace until graceEnds), paused. */
    limits: limits.limited
      ? {
          students: limits.students.state,
          staff: limits.staff.state,
          graceEnds: limits.graceEnds,
        }
      : null,
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

export { usageOf }

/* ---------- the daily check (the email cron) ---------- */

const PAST_DUE_DAYS = 7

/**
 * Each organization with plan limits, each time the email cron runs: grace starts or clears as its numbers go over
 * or back under; a period that ended unpaid becomes Payment due, then Paused after 7 days; and
 * whoever manages its billing hears once of each change (near, over, paused, due), in the bell
 * and by email.
 */
export async function checkPlans(now = new Date()) {
  const { limitsOf } = await import("./limits")
  const { notify } = await import("@/features/notifications/server")
  const { membersWhoCan } = await import("@/features/orgs/server")
  const db = getDb()
  const rows = await db
    .select({ org: organizations, sub: subscriptions })
    .from(subscriptions)
    .innerJoin(organizations, eq(organizations.id, subscriptions.orgId))
    .where(sql.isNotNull(organizations.planFeatures))
  let told = 0
  for (const { org, sub } of rows) {
    let status = sub.status
    if (status === "active" && sub.periodEnd && sub.periodEnd < now)
      status = "past_due"
    if (
      status === "past_due" &&
      sub.periodEnd &&
      now.getTime() - sub.periodEnd.getTime() > PAST_DUE_DAYS * 86_400_000
    )
      status = "paused"
    const limits = await limitsOf(org.id, now)
    const states = limits.limited
      ? [limits.students.state, limits.staff.state]
      : []
    const worst =
      (["paused", "over", "near"] as const).find((s) => states.includes(s)) ??
      "ok"
    const overSince =
      worst === "over" || worst === "paused" ? (sub.overSince ?? now) : null
    // Two kinds of notice, kept apart so one never hides the other: the limit, and the period
    // (renewal reminders 7 days and a day before it ends, then due and paused).
    const left = sub.periodEnd ? sub.periodEnd.getTime() - now.getTime() : null
    const period =
      status === "paused" || status === "past_due"
        ? `period:${status}`
        : status === "active" && left !== null && left > 0
          ? left <= 86_400_000
            ? "renew:1"
            : left <= 7 * 86_400_000
              ? "renew:7"
              : ""
          : ""
    const limit = worst === "ok" ? "" : `limit:${worst}`
    const notice = [limit, period].filter(Boolean).join("|")
    const before = new Set(sub.notice.split("|").filter(Boolean))
    const fresh = [limit, period].filter((n) => n && !before.has(n))
    if (
      status !== sub.status ||
      overSince?.getTime() !== sub.overSince?.getTime() ||
      notice !== sub.notice
    ) {
      await db
        .update(subscriptions)
        .set({ status, overSince, notice })
        .where(eq(subscriptions.orgId, org.id))
    }
    for (const key of fresh) {
      const words: Record<string, { title: string; body: string }> = {
        "limit:near": {
          title: `${org.name} is near its plan's limit`,
          body: "90% of the students or staff in your plan are in use. Add more from Plan and billing.",
        },
        "limit:over": {
          title: `${org.name} is over its plan's limit`,
          body: "More students or staff than the plan has. Everything works for 30 days; then adding people pauses until you add more.",
        },
        "limit:paused": {
          title: `Adding people is paused at ${org.name}`,
          body: "The 30 days past the plan's limit are over. Add more from Plan and billing to add people again; everything else keeps working.",
        },
        "period:past_due": {
          title: `${org.name}'s plan is due`,
          body: `The period ended. Pay within ${PAST_DUE_DAYS} days to keep adding people; everything else keeps working.`,
        },
        "period:paused": {
          title: `${org.name}'s plan is paused`,
          body: "It wasn't paid. Adding people is paused until it is; everything else keeps working.",
        },
        "renew:7": {
          title: `${org.name}'s plan renews within a week`,
          body: `The period ends on ${sub.periodEnd?.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}. Pay from Plan and billing to keep everything going.`,
        },
        "renew:1": {
          title: `${org.name}'s plan ends tomorrow`,
          body: "Pay from Plan and billing today to keep adding people after it ends.",
        },
      }
      const w = words[key]
      if (w) {
        const ids = await membersWhoCan(org.id, "org.billing.manage")
        await notify(ids, {
          kind: "billing",
          title: w.title,
          body: w.body,
          href: `/orgs/${org.slug}/manage/billing`,
          orgId: org.id,
        })
        told++
      }
    }
  }
  return { organizations: rows.length, told }
}
