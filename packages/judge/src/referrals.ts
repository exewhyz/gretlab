/**
 * Refer and earn (the owner's decisions, 26 November 2026; apps/web/features/referrals). Anyone
 * signed in has a personal link; the platform makes creator links (for sponsored creators) and
 * campaign coupons. An organization registered through a link, or paying with a code, is
 * attributed to it once. Each of its payments within N months of its first payment earns the
 * referrer a share of the amount before GST (5% for 3 months by default), and a code may also
 * give the organization a discount in that window. Earnings are tracked; the platform pays them
 * out by hand and marks them paid. Pure and unit-tested.
 */

/** What a code may look like: capitals, digits and dashes. */
export const REFERRAL_CODE = /^[A-Z0-9][A-Z0-9-]{2,23}$/

export function normalizeCode(text: string) {
  return text.trim().toUpperCase().replace(/\s+/g, "")
}

export interface CodeState {
  active: boolean
  validFrom: Date | null
  validTo: Date | null
  maxUses: number | null
  uses: number
}

/** Why a code can't be used now, or null when it can. */
export function codeProblem(code: CodeState, now: Date): string | null {
  if (!code.active) return "That code is paused."
  if (code.validFrom && now < code.validFrom)
    return "That code isn't valid yet."
  if (code.validTo && now > code.validTo) return "That code has expired."
  if (code.maxUses !== null && code.uses >= code.maxUses)
    return "That code has been used up."
  return null
}

/** `months` after `from`, ending on the last day of a shorter month rather than spilling over. */
function addMonths(from: Date, months: number) {
  const d = new Date(from)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

/**
 * Whether a payment made at `paidAt` is within the window that started with the organization's
 * first payment (`firstPaidAt`, null when this is the first). The window ends at the end of the
 * day N months later.
 */
export function inReferralWindow(
  firstPaidAt: Date | null,
  paidAt: Date,
  months: number
) {
  if (!firstPaidAt) return true
  const end = addMonths(firstPaidAt, months)
  end.setUTCHours(23, 59, 59, 999)
  return paidAt <= end
}

/** The referrer's share of a payment before GST, in whole rupees (rounded down). */
export function earningOf(amount: number, percent: number) {
  return Math.max(0, Math.floor((amount * percent) / 100))
}

/** A discount's rupees off an amount, rounded, never more than the amount. */
export function discountOf(amount: number, percent: number) {
  return Math.min(amount, Math.max(0, Math.round((amount * percent) / 100)))
}

/** Letters and digits that can't be misread: no 0, O, 1, I or L. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

/** A new personal code: eight characters from the alphabet above. */
export function newReferralCode(random: () => number = Math.random) {
  let code = ""
  for (let i = 0; i < 8; i++)
    code += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return code
}

/**
 * Who a code is for (the owner's decisions, 27 November 2026). An organization is new until its
 * first payment, existing while a paid plan is active, and inactive once it has paid but its plan
 * is past due, paused or back to free. A code lists any of them; none listed means everyone.
 */
export const ORG_STANDINGS = ["new", "existing", "inactive"] as const
export type OrgStanding = (typeof ORG_STANDINGS)[number]

export function orgStanding(everPaid: boolean, status: string): OrgStanding {
  if (!everPaid) return "new"
  return status === "active" ? "existing" : "inactive"
}

/** Why a code isn't for this organization, or null when it is. */
export function audienceProblem(
  forOrgs: readonly OrgStanding[],
  standing: OrgStanding
): string | null {
  if (forOrgs.length === 0 || forOrgs.includes(standing)) return null
  const names = ORG_STANDINGS.filter((s) => forOrgs.includes(s))
  return `This code is for ${names.join(" or ")} organizations.`
}

export interface DiscountLine {
  code: string
  label: string
  amount: number
}

/**
 * The discount on one payment. `referral` is the code the organization came through (when it
 * still gives a discount), `promo` the one code typed at checkout. A promo code that combines
 * adds to the referral discount (never past the amount); one that doesn't replaces it. The same
 * code typed again counts once.
 */
export function codesDiscount(
  amount: number,
  referral: { code: string; percent: number } | null,
  promo: { code: string; percent: number; combines: boolean } | null
): { discount: number; lines: DiscountLine[]; replaced: boolean } {
  const lines: DiscountLine[] = []
  const ref =
    referral && referral.percent > 0 ? discountOf(amount, referral.percent) : 0
  // A typed code that gives nothing (a creator's link) leaves the referral discount as it is.
  const typed =
    promo && promo.code !== referral?.code && promo.percent > 0 ? promo : null
  let replaced = false
  if (ref > 0 && (!typed || typed.combines))
    lines.push({
      code: referral!.code,
      label: "Referral discount",
      amount: ref,
    })
  else if (ref > 0 && typed) replaced = true
  if (typed) {
    const left = amount - lines.reduce((n, l) => n + l.amount, 0)
    const off = Math.min(left, discountOf(amount, typed.percent))
    if (off > 0)
      lines.push({ code: typed.code, label: "Promo code", amount: off })
  }
  return {
    discount: lines.reduce((n, l) => n + l.amount, 0),
    lines,
    replaced,
  }
}
