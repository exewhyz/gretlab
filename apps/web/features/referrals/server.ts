/**
 * Refer and earn (rules: packages/judge/src/referrals.ts; the owner's decisions, 26 November
 * 2026). Everyone signed in has a personal code (/r/<code>); the platform makes creator links
 * and campaign coupons. An organization is attributed to a code once: when it's registered
 * through a link (a cookie), created with a code, or pays with one first. Each payment within
 * the window earns the referrer their share before GST, and a code's discount applies in the
 * same window. Earnings are tracked here and paid out by hand.
 */
import {
  getDb,
  orgMembers,
  orgReferrals,
  organizations,
  payments,
  referralCodes,
  subscriptions,
  referralEarnings,
  sql,
  users,
  type User,
} from "@workspace/db"
import {
  audienceProblem,
  codeProblem,
  codesDiscount,
  ORG_STANDINGS,
  orgStanding,
  earningOf,
  inReferralWindow,
  newReferralCode,
  normalizeCode,
  REFERRAL_CODE,
} from "@workspace/judge"
import { z } from "zod"

import { getSettings, updateSettings } from "@/features/settings/server"
import { writePlatformAudit } from "@/features/platform/staff"
import { ApiError, notFound } from "@/lib/api/route"

const { and, desc, eq, inArray } = sql
const raw = sql.sql

/** The cookie a referral link sets, read when someone registers an organization. */
export const REFERRAL_COOKIE = "gl_ref"
export const REFERRAL_COOKIE_DAYS = 30

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

async function referralSettings() {
  const s = await getSettings()
  return {
    enabled: s["referral.enabled"],
    percent: s["referral.percent"],
    months: s["referral.months"],
  }
}

/** A code as stored, or null. */
export async function findCode(text: string) {
  const code = normalizeCode(text)
  if (!REFERRAL_CODE.test(code)) return null
  const [row] = await getDb()
    .select()
    .from(referralCodes)
    .where(eq(referralCodes.code, code))
  return row ?? null
}

/** The person's own code, made the first time it's asked for. */
async function personalCode(userId: string) {
  const db = getDb()
  const [mine] = await db
    .select()
    .from(referralCodes)
    .where(
      and(eq(referralCodes.ownerId, userId), eq(referralCodes.kind, "personal"))
    )
  if (mine) return mine
  for (let tries = 0; tries < 5; tries++) {
    const [made] = await db
      .insert(referralCodes)
      .values({ code: newReferralCode(), kind: "personal", ownerId: userId })
      .onConflictDoNothing()
      .returning()
    if (made) return made
  }
  const [again] = await db
    .select()
    .from(referralCodes)
    .where(
      and(eq(referralCodes.ownerId, userId), eq(referralCodes.kind, "personal"))
    )
  if (!again) throw new Error("Couldn't make a referral code")
  return again
}

/**
 * Attributes an organization to a code, once: never if it already has one, if the code can't be
 * used, or if the code's owner is the person creating it or already one of its members.
 */
export async function attribute(
  orgId: string,
  text: string,
  creatorId: string | null,
  db: Db | Tx = getDb()
) {
  const settings = await referralSettings()
  if (!settings.enabled) return false
  const code = await findCode(text)
  if (!code || codeProblem(code, new Date())) return false
  if (code.ownerId && code.ownerId === creatorId) return false
  if (code.ownerId) {
    const [member] = await db
      .select({ id: orgMembers.userId })
      .from(orgMembers)
      .where(
        and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, code.ownerId))
      )
    if (member) return false
  }
  const [made] = await db
    .insert(orgReferrals)
    .values({ orgId, code: code.code, referrerId: code.ownerId })
    .onConflictDoNothing()
    .returning({ orgId: orgReferrals.orgId })
  if (!made) return false
  await db
    .update(referralCodes)
    .set({ uses: raw`${referralCodes.uses} + 1` })
    .where(eq(referralCodes.code, code.code))
  return true
}

/** Where an organization stands for a code's "who it's for": new, existing or inactive. */
async function standingOf(orgId: string) {
  const db = getDb()
  const [[paid], [sub]] = await Promise.all([
    db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.orgId, orgId), eq(payments.status, "paid")))
      .limit(1),
    db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, orgId)),
  ])
  return orgStanding(Boolean(paid), sub?.status ?? "free")
}

/**
 * The discount on one payment of `amount` (before GST), worked out on the server for both
 * Apply (a preview, `attribute: false`) and Pay. The organization's referral code gives its
 * discount in its window; one typed code may add to it (`combines`) or replace it, and is
 * refused when it can't be used now, is the payer's own, or isn't for this organization
 * (`forOrgs`). A typed code attributes an organization that has no referral yet, at Pay only.
 */
export async function priceCodes(
  orgId: string,
  typed: string | null | undefined,
  amount: number,
  payerId: string,
  { attribute: attributing }: { attribute: boolean }
) {
  const settings = await referralSettings()
  const none = {
    coupon: null as string | null,
    discount: 0,
    lines: [] as { code: string; label: string; amount: number }[],
    replaced: false,
  }
  const text = typed?.trim() ? typed : null
  if (!settings.enabled) {
    if (text)
      throw new ApiError(400, "bad_code", "Codes can't be used right now.")
    return none
  }
  const db = getDb()
  const [came] = await db
    .select()
    .from(orgReferrals)
    .where(eq(orgReferrals.orgId, orgId))
  const now = new Date()
  const inWindow = (code: { months: number | null }) =>
    inReferralWindow(
      came?.firstPaidAt ?? null,
      now,
      code.months ?? settings.months
    )
  let promo = null
  if (text) {
    promo = await findCode(text)
    if (!promo) throw new ApiError(400, "bad_code", "There's no such code.")
    const problem =
      codeProblem(promo, now) ??
      (promo.ownerId === payerId ? "You can't use your own code." : null) ??
      audienceProblem(promo.forOrgs, await standingOf(orgId))
    if (problem) throw new ApiError(400, "bad_code", problem)
    if (!came && attributing) await attribute(orgId, promo.code, payerId)
  }
  // The code the organization came through, unless the typed one is now its referral.
  const referral =
    came && came.code !== promo?.code ? await findCode(came.code) : null
  const result = codesDiscount(
    amount,
    // Its own code keeps giving its discount in the window, even once the code is used up.
    referral && inWindow(referral)
      ? { code: referral.code, percent: referral.discountPercent }
      : null,
    promo && inWindow(promo)
      ? {
          code: promo.code,
          percent: promo.discountPercent,
          combines: promo.combines,
        }
      : null
  )
  return {
    coupon: promo?.code ?? referral?.code ?? null,
    ...result,
  }
}

/**
 * When a payment is applied (billing/pay.ts, inside its transaction): the organization's first
 * payment opens the window, and a payment within it earns its referrer their share before GST.
 * Once per payment; campaign coupons earn nobody; organizations waiting for approval don't earn.
 */
export async function recordEarning(
  tx: Tx,
  payment: { id: string; org_id: string; amount: number },
  now = new Date()
) {
  const settings = await referralSettings()
  const [came] = await tx
    .select()
    .from(orgReferrals)
    .where(eq(orgReferrals.orgId, payment.org_id))
  if (!came) return
  const firstPaidAt = came.firstPaidAt
  if (!firstPaidAt)
    await tx
      .update(orgReferrals)
      .set({ firstPaidAt: now })
      .where(eq(orgReferrals.orgId, payment.org_id))
  if (!settings.enabled || !came.referrerId) return
  const [org] = await tx
    .select({
      active: organizations.active,
      pending: organizations.signupStatus,
    })
    .from(organizations)
    .where(eq(organizations.id, payment.org_id))
  if (!org?.active || org.pending === "pending") return
  const [code] = await tx
    .select()
    .from(referralCodes)
    .where(eq(referralCodes.code, came.code))
  const percent = code?.percent ?? settings.percent
  const months = code?.months ?? settings.months
  if (!inReferralWindow(firstPaidAt, now, months)) return
  const amount = earningOf(payment.amount, percent)
  if (amount <= 0) return
  await tx
    .insert(referralEarnings)
    .values({
      paymentId: payment.id,
      orgId: payment.org_id,
      code: came.code,
      referrerId: came.referrerId,
      amount,
      percent,
    })
    .onConflictDoNothing()
}

/* ---------- the person's side: Account › Refer and earn ---------- */

const STAGE = (o: {
  active: boolean
  signupStatus: string | null
  firstPaidAt: Date | null
}) =>
  o.signupStatus === "pending"
    ? ("waiting" as const)
    : !o.active
      ? ("paused" as const)
      : o.firstPaidAt
        ? ("paying" as const)
        : ("active" as const)

export async function myReferrals(user: User) {
  const settings = await referralSettings()
  const code = await personalCode(user.id)
  const db = getDb()
  const [referred, earned] = await Promise.all([
    db
      .select({
        name: organizations.name,
        active: organizations.active,
        signupStatus: organizations.signupStatus,
        firstPaidAt: orgReferrals.firstPaidAt,
        since: orgReferrals.createdAt,
      })
      .from(orgReferrals)
      .innerJoin(organizations, eq(organizations.id, orgReferrals.orgId))
      .where(eq(orgReferrals.referrerId, user.id))
      .orderBy(desc(orgReferrals.createdAt))
      .limit(500),
    db
      .select({
        id: referralEarnings.id,
        org: organizations.name,
        amount: referralEarnings.amount,
        percent: referralEarnings.percent,
        status: referralEarnings.status,
        createdAt: referralEarnings.createdAt,
        paidAt: referralEarnings.paidAt,
      })
      .from(referralEarnings)
      .innerJoin(organizations, eq(organizations.id, referralEarnings.orgId))
      .where(eq(referralEarnings.referrerId, user.id))
      .orderBy(desc(referralEarnings.createdAt))
      .limit(500),
  ])
  const total = (status: string) =>
    earned.filter((e) => e.status === status).reduce((n, e) => n + e.amount, 0)
  return {
    enabled: settings.enabled,
    code: code.code,
    path: `/r/${code.code}`,
    percent: code.percent ?? settings.percent,
    months: code.months ?? settings.months,
    referrals: referred.map((r) => ({
      name: r.name,
      stage: STAGE(r),
      since: r.since,
    })),
    earnings: earned,
    owed: total("owed"),
    paid: total("paid"),
  }
}

/* ---------- the platform's side: Dashboard › Referrals ---------- */

export const codeInputSchema = z.object({
  code: z
    .string()
    .transform(normalizeCode)
    .refine((c) => REFERRAL_CODE.test(c), "3 to 24 letters, digits or dashes"),
  kind: z.enum(["creator", "campaign"]),
  /** A creator's email: they earn from it. */
  ownerEmail: z.email().toLowerCase().nullable().optional(),
  percent: z.number().int().min(0).max(50).nullable(),
  months: z.number().int().min(1).max(36).nullable(),
  discountPercent: z.number().int().min(0).max(100),
  validFrom: z.iso.datetime({ offset: true }).nullable(),
  validTo: z.iso.datetime({ offset: true }).nullable(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable(),
  active: z.boolean(),
  note: z.string().trim().max(500),
  /** Who may type it at checkout (none: everyone). */
  forOrgs: z.array(z.enum(ORG_STANDINGS)).max(3).default([]),
  /** Typed at checkout, whether it adds to the organization's referral discount. */
  combines: z.boolean().default(false),
})

export async function adminReferrals() {
  const db = getDb()
  const [settings, codes, referred, earnings] = await Promise.all([
    referralSettings(),
    db
      .select({
        code: referralCodes.code,
        kind: referralCodes.kind,
        owner: users.email,
        ownerName: users.name,
        percent: referralCodes.percent,
        months: referralCodes.months,
        discountPercent: referralCodes.discountPercent,
        validFrom: referralCodes.validFrom,
        validTo: referralCodes.validTo,
        maxUses: referralCodes.maxUses,
        uses: referralCodes.uses,
        active: referralCodes.active,
        note: referralCodes.note,
        forOrgs: referralCodes.forOrgs,
        combines: referralCodes.combines,
        createdAt: referralCodes.createdAt,
      })
      .from(referralCodes)
      .leftJoin(users, eq(users.id, referralCodes.ownerId))
      .where(
        raw`${referralCodes.kind} <> 'personal' or ${referralCodes.uses} > 0`
      )
      .orderBy(desc(referralCodes.createdAt))
      .limit(500),
    db
      .select({
        orgId: organizations.id,
        org: organizations.name,
        slug: organizations.slug,
        code: orgReferrals.code,
        referrer: users.email,
        since: orgReferrals.createdAt,
        firstPaidAt: orgReferrals.firstPaidAt,
        active: organizations.active,
        signupStatus: organizations.signupStatus,
      })
      .from(orgReferrals)
      .innerJoin(organizations, eq(organizations.id, orgReferrals.orgId))
      .leftJoin(users, eq(users.id, orgReferrals.referrerId))
      .orderBy(desc(orgReferrals.createdAt))
      .limit(500),
    db
      .select({
        id: referralEarnings.id,
        org: organizations.name,
        referrer: users.email,
        referrerName: users.name,
        code: referralEarnings.code,
        amount: referralEarnings.amount,
        percent: referralEarnings.percent,
        payment: payments.amount,
        status: referralEarnings.status,
        createdAt: referralEarnings.createdAt,
        paidAt: referralEarnings.paidAt,
        payoutNote: referralEarnings.payoutNote,
      })
      .from(referralEarnings)
      .innerJoin(organizations, eq(organizations.id, referralEarnings.orgId))
      .innerJoin(payments, eq(payments.id, referralEarnings.paymentId))
      .leftJoin(users, eq(users.id, referralEarnings.referrerId))
      .orderBy(
        raw`case ${referralEarnings.status} when 'owed' then 0 else 1 end`,
        desc(referralEarnings.createdAt)
      )
      .limit(1000),
  ])
  const sum = (status: string) =>
    earnings
      .filter((e) => e.status === status)
      .reduce((n, e) => n + e.amount, 0)
  return {
    settings,
    codes,
    referrals: referred.map((r) => ({ ...r, stage: STAGE(r) })),
    earnings,
    owed: sum("owed"),
    paid: sum("paid"),
  }
}

/** Makes or changes a creator link or a campaign coupon. */
export async function saveCode(
  user: User,
  input: z.infer<typeof codeInputSchema>
) {
  const db = getDb()
  let ownerId: string | null = null
  if (input.kind === "creator") {
    if (!input.ownerEmail)
      throw new ApiError(
        400,
        "owner_needed",
        "A creator link needs the creator's email."
      )
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.ownerEmail))
    if (!owner)
      throw new ApiError(
        400,
        "no_such_user",
        "Nobody with that email has an account yet."
      )
    ownerId = owner.id
  }
  const [existing] = await db
    .select()
    .from(referralCodes)
    .where(eq(referralCodes.code, input.code))
  if (existing?.kind === "personal")
    throw new ApiError(409, "code_taken", "That's someone's personal code.")
  const values = {
    kind: input.kind,
    ownerId,
    percent: input.percent,
    months: input.months,
    discountPercent: input.discountPercent,
    validFrom: input.validFrom ? new Date(input.validFrom) : null,
    validTo: input.validTo ? new Date(input.validTo) : null,
    maxUses: input.maxUses,
    active: input.active,
    note: input.note,
    forOrgs: [...new Set(input.forOrgs)],
    combines: input.combines,
  }
  await db
    .insert(referralCodes)
    .values({ code: input.code, createdBy: user.id, ...values })
    .onConflictDoUpdate({ target: referralCodes.code, set: values })
  await writePlatformAudit(
    user,
    "referral.code",
    `${existing ? "Changed" : "Made"} the ${input.kind} code ${input.code}`,
    {
      code: input.code,
      discountPercent: input.discountPercent,
      forOrgs: input.forOrgs,
      combines: input.combines,
    }
  )
  return { code: input.code }
}

export const payoutSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  status: z.enum(["paid", "void", "owed"]),
  note: z.string().trim().max(300).default(""),
})

/** Marks earnings paid (paid out by hand), void, or owed again. Logged. */
export async function settleEarnings(
  user: User,
  input: z.infer<typeof payoutSchema>
) {
  const rows = await getDb()
    .update(referralEarnings)
    .set({
      status: input.status,
      paidAt: input.status === "paid" ? new Date() : null,
      paidBy: input.status === "paid" ? user.id : null,
      payoutNote: input.note,
    })
    .where(inArray(referralEarnings.id, input.ids))
    .returning({ amount: referralEarnings.amount })
  if (rows.length === 0) throw notFound("Nothing to settle")
  const total = rows.reduce((n, r) => n + r.amount, 0)
  await writePlatformAudit(
    user,
    "referral.payout",
    `Marked ${rows.length} referral earning${rows.length === 1 ? "" : "s"} (₹${total.toLocaleString("en-IN")}) ${input.status}`,
    { ids: input.ids, status: input.status, note: input.note }
  )
  return { settled: rows.length, total }
}

export const referralSettingsSchema = z.object({
  "referral.enabled": z.boolean().optional(),
  "referral.percent": z.number().int().min(0).max(50).optional(),
  "referral.months": z.number().int().min(1).max(36).optional(),
})

/** The share, the window and the switch. Logged. */
export async function saveReferralSettings(
  user: User,
  changes: z.infer<typeof referralSettingsSchema>
) {
  await updateSettings(changes)
  await writePlatformAudit(
    user,
    "referral.settings",
    "Changed the referral rules",
    changes
  )
  return referralSettings()
}
