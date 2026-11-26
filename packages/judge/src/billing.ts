/*
 * Plans and prices (apps/web/features/billing): each feature has a price per student per year,
 * set by platform staff; an organization picks features, students, staff and extras, and a
 * period (month, semester or year). Pure and unit-tested (billing.test.ts); the price builder in
 * the browser and the server use these same functions, so what's shown is what's charged.
 * Amounts are whole rupees (an invoice rounds once, at the end).
 */

import {
  MODULE_KEYS,
  moduleAvailable,
  type KindPolicy,
  type ModuleKey,
  type OrgType,
} from "./org-types.ts"

export type BillingPeriod = "month" | "semester" | "year"
export const BILLING_PERIODS: readonly BillingPeriod[] = [
  "month",
  "semester",
  "year",
]

export interface PricedFeature {
  key: string
  /** Rupees per student per year. */
  price: number
  /** Always in every plan (classes and teaching). */
  always?: boolean
  /** Features this one can't work without; choosing it chooses them. */
  needs?: string[]
}

export interface PriceList {
  features: PricedFeature[]
  /** Rupees a year for each staff member past the free ones. */
  staffPrice: number
  /** One staff member free for every this many students. */
  freeStaffPer: number
  /** Volume steps on the student part: [students up to (null: the rest), percent off]. */
  steps: [number | null, number][]
  /** Percent added for paying by the semester or month (yearly is the list price). */
  periods: Record<BillingPeriod, number>
  /** More students than this: a custom quote, not the builder. */
  quoteAbove: number
  /** Rupees a year for an organization's own judge machine (class hours). */
  judgePrice: number
  /** Rupees a year for each 50 GB of storage past what's included. */
  storagePrice: number
}

export interface PlanChoice {
  features: string[]
  students: number
  staff: number
  judges: number
  storagePacks: number
  period: BillingPeriod
}

/** What a feature switches on: modules (org-types.ts) and features checked by name. */
export interface FeatureInfo {
  key: string
  name: string
  what: string
  group: string
  /** The organization modules it switches on, if any. */
  modules?: string[]
  /** For a feature that isn't a module: the only kinds of organization that can use it. */
  onlyKinds?: OrgType[]
}

/** The launch price list (24 November 2026), set against Indian school and college ERP prices. */
export const DEFAULT_FEATURES: (PricedFeature & FeatureInfo)[] = [
  {
    key: "core",
    name: "Classes and teaching",
    what: "Class pages, notices, discussions, calendar, notifications, reports",
    group: "Always included",
    price: 10,
    always: true,
  },
  {
    key: "coding",
    name: "Coding lab",
    what: "Problems, practice, assignments graded automatically, contests, question bank",
    group: "Coding lab",
    price: 49,
    modules: ["coding"],
  },
  {
    key: "exams_lab",
    name: "Lab exams",
    what: "Timed sittings, network limits, the site lock, warnings",
    group: "Coding lab",
    price: 15,
    needs: ["coding"],
  },
  {
    key: "courses",
    name: "Courses and certificates",
    what: "Modules, readings, checkpoints, certificates",
    group: "Coding lab",
    price: 10,
  },
  {
    key: "peer",
    name: "Peer review and projects",
    what: "Classmates review code; GitHub projects",
    group: "Coding lab",
    price: 5,
    needs: ["coding"],
  },
  {
    key: "outcomes",
    name: "Outcomes (CO–PO)",
    what: "Course and program outcome attainment",
    group: "Coding lab",
    price: 5,
  },
  {
    key: "records",
    name: "Student records",
    what: "Admission numbers, years, promotion, ID cards, transfer certificates",
    group: "Academics",
    price: 10,
    modules: ["records"],
  },
  {
    key: "attendance",
    name: "Attendance",
    what: "Registers, course-wise attendance, reports",
    group: "Academics",
    price: 10,
    modules: ["attendance"],
  },
  {
    key: "timetable",
    name: "Timetable and subjects",
    what: "Subjects, periods, class timetables, teachers' weeks",
    group: "Academics",
    price: 5,
    modules: ["timetable", "subjects"],
  },
  {
    key: "results",
    name: "Exams and report cards",
    what: "Marks, grades, SGPA/CGPA, printable report cards",
    group: "Academics",
    price: 15,
    needs: ["records", "timetable"],
    modules: ["exams"],
  },
  {
    key: "admissions",
    name: "Admissions",
    what: "Online applications, review, admitting",
    group: "Academics",
    price: 5,
    needs: ["records"],
    modules: ["admissions"],
  },
  {
    key: "parents",
    name: "Parent accounts",
    what: "Parents follow their child; absence alerts",
    group: "People and campus",
    price: 5,
    modules: ["parents"],
  },
  {
    key: "leave",
    name: "Leave and staff attendance",
    what: "Leave requests, balances, staff check-in",
    group: "People and campus",
    price: 5,
    modules: ["leave", "staffAttendance"],
  },
  {
    key: "library",
    name: "Library",
    what: "Books, loans, due reminders",
    group: "People and campus",
    price: 3,
    modules: ["library"],
  },
  {
    key: "transport",
    name: "Transport",
    what: "Routes, stops, riders",
    group: "People and campus",
    price: 3,
    modules: ["transport"],
  },
  {
    key: "hostel",
    name: "Hostel",
    what: "Rooms, beds, residents",
    group: "People and campus",
    price: 3,
    modules: ["hostel"],
  },
  {
    key: "training",
    name: "Assigned training",
    what: "Courses with due dates and renewal, for companies",
    group: "Companies, cohorts, communities",
    price: 30,
    modules: ["training"],
  },
  {
    key: "runs",
    name: "Cohort runs and mentors",
    what: "Run dates, mentors, graduation",
    group: "Companies, cohorts, communities",
    price: 5,
    // Runs need group dates (KindDefinition.groupDates).
    onlyKinds: ["cohort", "coaching"],
  },
  {
    key: "events",
    name: "Events",
    what: "Events with places, waitlists and reminders",
    group: "Companies, cohorts, communities",
    price: 3,
    modules: ["events"],
  },
  {
    key: "lti",
    name: "LMS (LTI 1.3)",
    what: "Moodle and Canvas launches, grades sent back",
    group: "Connections",
    price: 5,
  },
  {
    key: "api",
    name: "API keys and webhooks",
    what: "Other systems read GretLab and hear what happens",
    group: "Connections",
    price: 5,
  },
]

export const DEFAULT_PRICE_LIST: PriceList = {
  features: DEFAULT_FEATURES.map(({ key, price, always, needs }) => ({
    key,
    price,
    always,
    needs,
  })),
  staffPrice: 300,
  freeStaffPer: 15,
  steps: [
    [300, 0],
    [1000, 10],
    [3000, 15],
    [null, 20],
  ],
  periods: { year: 0, semester: 10, month: 25 },
  quoteAbove: 10_000,
  judgePrice: 72_000,
  storagePrice: 500,
}

/** The chosen features, with what's always in and what each needs; unknown keys dropped. */
export function withNeeds(list: PriceList, features: readonly string[]) {
  const byKey = new Map(list.features.map((f) => [f.key, f]))
  const out = new Set(list.features.filter((f) => f.always).map((f) => f.key))
  const add = (key: string) => {
    const f = byKey.get(key)
    if (!f || out.has(key)) return
    out.add(key)
    for (const n of f.needs ?? []) add(n)
  }
  for (const key of features) add(key)
  return [...out]
}

/**
 * Whether an organization of this kind can use a feature, and so buy it: its modules must be
 * ones the kind runs and the platform hasn't switched off for it (`policy`, org_kind_policies),
 * a feature that isn't a module must suit the kind, and so must everything it needs.
 */
export function featureAvailable(
  key: string,
  kind: OrgType,
  policy?: KindPolicy | null,
  seen = new Set<string>()
): boolean {
  const info = DEFAULT_FEATURES.find((f) => f.key === key)
  if (!info) return false
  if (seen.has(key)) return true
  seen.add(key)
  if (info.onlyKinds && !info.onlyKinds.includes(kind)) return false
  if (
    info.modules &&
    !info.modules.some((m) => moduleAvailable(kind, m as ModuleKey, policy))
  )
    return false
  return (info.needs ?? []).every((n) =>
    featureAvailable(n, kind, policy, seen)
  )
}

/**
 * A change to a plan during its period. What it adds (features, more students, staff, judges,
 * storage) applies now, paid for the days left; what it removes or lowers waits for renewal,
 * since nothing is refunded. `now` is the plan from today; `next` the choice, kept for the next
 * period when it differs from `now` (null otherwise).
 */
export function splitChange(
  list: PriceList,
  current: PlanChoice,
  choice: PlanChoice
): { now: PlanChoice; next: PlanChoice | null } {
  const now: PlanChoice = {
    features: [
      ...new Set([
        ...withNeeds(list, current.features),
        ...withNeeds(list, choice.features),
      ]),
    ],
    students: Math.max(current.students, choice.students),
    staff: Math.max(current.staff, choice.staff),
    judges: Math.max(current.judges, choice.judges),
    storagePacks: Math.max(current.storagePacks, choice.storagePacks),
    period: current.period,
  }
  return { now, next: samePlan(list, now, choice) ? null : choice }
}

/** How many days before a period ends it can be renewed (paid for again, or its way of paying changed). */
export const RENEW_WINDOW_DAYS = 7

/** Whether two plans are the same: features (with what they need, in any order), counts and period. */
export function samePlan(list: PriceList, a: PlanChoice, b: PlanChoice) {
  const fa = withNeeds(list, a.features).sort()
  const fb = withNeeds(list, b.features).sort()
  return (
    fa.length === fb.length &&
    fa.every((k, i) => k === fb[i]) &&
    a.students === b.students &&
    a.staff === b.staff &&
    a.judges === b.judges &&
    a.storagePacks === b.storagePacks &&
    a.period === b.period
  )
}

/** Students priced in steps, like tax slabs: each step's students at that step's discount. */
function stepped(list: PriceList, students: number, perStudent: number) {
  let left = students
  let from = 0
  let total = 0
  for (const [upTo, off] of list.steps) {
    const room = upTo === null ? left : Math.max(0, upTo - from)
    const here = Math.min(left, room)
    total += (here * perStudent * (100 - off)) / 100
    left -= here
    if (upTo !== null) from = upTo
    if (left <= 0) break
  }
  return total
}

const MONTHS: Record<BillingPeriod, number> = {
  month: 1,
  semester: 6,
  year: 12,
}

export function priceOfPlan(list: PriceList, choice: PlanChoice) {
  const features = withNeeds(list, choice.features)
  const byKey = new Map(list.features.map((f) => [f.key, f]))
  const perStudent = features.reduce(
    (n, k) => n + (byKey.get(k)?.price ?? 0),
    0
  )
  const students = Math.max(0, Math.floor(choice.students))
  const staff = Math.max(0, Math.floor(choice.staff))
  const studentsPart = stepped(list, students, perStudent)
  const freeStaff = Math.ceil(students / Math.max(1, list.freeStaffPer))
  const paidStaff = Math.max(0, staff - freeStaff)
  const staffPart = paidStaff * list.staffPrice
  const extras =
    Math.max(0, Math.floor(choice.judges)) * list.judgePrice +
    Math.max(0, Math.floor(choice.storagePacks)) * list.storagePrice
  const yearly = studentsPart + staffPart + extras
  // A shorter period: its share of the year, plus its percentage.
  const share = MONTHS[choice.period] / 12
  const price = Math.round(
    yearly * share * (1 + (list.periods[choice.period] ?? 0) / 100)
  )
  return {
    features,
    perStudent,
    studentsPart: Math.round(studentsPart),
    discount: Math.round(students * perStudent - studentsPart),
    freeStaff,
    paidStaff,
    staffPart,
    extras,
    yearly: Math.round(yearly),
    /** What one period costs, before GST. */
    price,
    /** Too big for the builder: a custom quote. */
    quote: students > list.quoteAbove,
  }
}

/** When a period that starts at `start` ends: a calendar month, six months or a year on. */
export function periodEnd(start: Date, period: BillingPeriod) {
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + MONTHS[period])
  return end
}

/**
 * What adding costs mid-period: the new plan's price less the current one's (same period), for
 * the share of the period left. Removing costs nothing now (it applies at the next period).
 */
export function upgradeDue(
  list: PriceList,
  current: PlanChoice,
  next: PlanChoice,
  start: Date,
  end: Date,
  now: Date
) {
  const length = end.getTime() - start.getTime()
  const left = Math.max(0, end.getTime() - now.getTime())
  if (length <= 0 || left <= 0) return 0
  const period = current.period
  const difference =
    priceOfPlan(list, { ...next, period }).price -
    priceOfPlan(list, { ...current, period }).price
  return Math.max(0, Math.round((difference * left) / length))
}

/** India's GST state codes (01–38, and 97 for other territory). */
const STATE = (code: number) => (code >= 1 && code <= 38) || code === 97

export function validGstin(value: string) {
  const v = value.trim().toUpperCase()
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) return false
  return STATE(Number(v.slice(0, 2)))
}

/**
 * GST on an amount: CGST and SGST (half each) when buyer and seller are in the same state (or
 * the buyer gave no GSTIN), IGST across states; nothing when the seller isn't registered.
 */
export function gstSplit(
  amount: number,
  seller: { registered: boolean; rate: number; sellerGstin: string },
  buyerGstin: string | null
) {
  const taxable = Math.round(amount)
  if (!seller.registered || seller.rate <= 0)
    return { taxable, cgst: 0, sgst: 0, igst: 0, total: taxable }
  const tax = Math.round((taxable * seller.rate) / 100)
  const sameState =
    !buyerGstin ||
    buyerGstin.trim().slice(0, 2) === seller.sellerGstin.trim().slice(0, 2)
  if (sameState) {
    const half = Math.round(tax / 2)
    return {
      taxable,
      cgst: half,
      sgst: tax - half,
      igst: 0,
      total: taxable + tax,
    }
  }
  return { taxable, cgst: 0, sgst: 0, igst: tax, total: taxable + tax }
}

/** "GL/2026-27/000123": numbered within India's financial year (April to March). */
export function invoiceNumber(date: Date, sequence: number) {
  // Financial years turn on 1 April in India (IST); a few hours either side don't matter here.
  const y = date.getUTCFullYear()
  const start = date.getUTCMonth() >= 3 ? y : y - 1
  const fy = `${start}-${String((start + 1) % 100).padStart(2, "0")}`
  return `GL/${fy}/${String(sequence).padStart(6, "0")}`
}

/** The financial year an invoice belongs to, as its numbering does ("2026-27"). */
export function financialYear(date: Date) {
  return invoiceNumber(date, 0).split("/")[1]!
}

/** Days of grace past a limit before adding people pauses. */
export const LIMIT_GRACE_DAYS = 30

/**
 * Where an organization is against something it bought (students, staff): fine, near (90%),
 * over (with grace since `overSince`), or paused once the grace is over. Running work is never
 * paused; only adding more.
 */
export function limitState(
  used: number,
  bought: number,
  overSince: Date | null,
  now: Date
): "ok" | "near" | "over" | "paused" {
  if (used <= bought) return used >= bought * 0.9 ? "near" : "ok"
  if (!overSince) return "over"
  const days = (now.getTime() - overSince.getTime()) / 86_400_000
  return days >= LIMIT_GRACE_DAYS ? "paused" : "over"
}

/** The features an organization's plan holds, as stored (null: no plan limits, everything). */
export function readPlanFeatures(stored: unknown): string[] | null {
  if (!Array.isArray(stored)) return null
  return stored.filter((k): k is string => typeof k === "string")
}

/** The modules a plan's features switch on (each feature's `modules`). */
export function planModules(features: readonly string[]) {
  const on = new Set<ModuleKey>()
  for (const f of DEFAULT_FEATURES)
    if (features.includes(f.key))
      for (const m of f.modules ?? []) on.add(m as ModuleKey)
  return on
}

/**
 * The plan as one more layer of the module rules (org-types.ts): every module the plan's
 * features don't switch on is off. No plan limits (null): nothing changes.
 */
export function planModulePolicy(
  stored: unknown
): Partial<Record<ModuleKey, "off">> {
  const features = readPlanFeatures(stored)
  if (!features) return {}
  const on = planModules(features)
  const out: Partial<Record<ModuleKey, "off">> = {}
  for (const key of MODULE_KEYS) if (!on.has(key)) out[key] = "off"
  return out
}

/** Whether a plan includes a feature (no plan limits: everything). */
export function planIncludes(stored: unknown, feature: string) {
  const features = readPlanFeatures(stored)
  return !features || features.includes(feature)
}

/** What a free plan holds (Billing switched on, before an organization buys). */
export const FREE_FEATURES = ["core", "coding"] as const

/** Ready-made plans: the usual features for a kind of organization, and a typical size. */
export const PLAN_PRESETS = [
  {
    key: "coding-lab",
    name: "Coding lab",
    features: ["coding", "exams_lab", "courses", "peer", "outcomes", "lti"],
    students: 600,
    staff: 25,
  },
  {
    key: "college",
    name: "College",
    features: [
      "coding",
      "exams_lab",
      "courses",
      "outcomes",
      "records",
      "attendance",
      "timetable",
      "results",
      "admissions",
      "parents",
      "leave",
      "library",
      "lti",
    ],
    students: 2000,
    staff: 120,
  },
  {
    key: "school",
    name: "School",
    features: [
      "records",
      "attendance",
      "timetable",
      "results",
      "admissions",
      "parents",
      "leave",
      "library",
      "transport",
      "coding",
    ],
    students: 800,
    staff: 55,
  },
  {
    key: "coaching",
    name: "Coaching",
    features: ["coding", "exams_lab", "courses", "attendance", "runs"],
    students: 300,
    staff: 15,
  },
  {
    key: "company",
    name: "Company training",
    features: ["courses", "training", "coding", "api"],
    students: 200,
    staff: 20,
  },
] as const

// ---------- revenue and margin (Dashboard › Plans › Revenue)

/**
 * What a plan brings in a month (₹, before GST): its period's price spread over the period's
 * months, while it's paid for (active) or a deal set by hand (custom). Free, past due and
 * paused plans bring nothing.
 */
export function monthlyRevenue(
  price: number,
  period: BillingPeriod,
  status: "free" | "active" | "past_due" | "paused" | "custom"
) {
  return status === "active" || status === "custom" ? price / MONTHS[period] : 0
}

export interface MarginInput {
  id: string
  /** ₹ a month (monthlyRevenue). */
  monthly: number
  /** US$ this month for its own judge machines (forecast to the month's end). */
  ownCost: number
  /** Submissions (runs too) of its work this month. */
  submissions: number
  /** Whether it had judge machines of its own this month: its work ran on them, not the shared ones. */
  ownJudges: boolean
}

/**
 * Each organization's revenue against what its judging costs, in ₹: its own machines, plus the
 * shared machines' cost split by how much of their work was its (submissions this month, among
 * organizations without judges of their own and personal practice, the platform's own share).
 * An estimate: the shared judges also take work from organizations whose own judges were down.
 */
export function margins(
  orgs: MarginInput[],
  shared: { sharedCost: number; platformSubmissions: number; usdRate: number }
) {
  const onShared =
    orgs.reduce((n, o) => n + (o.ownJudges ? 0 : o.submissions), 0) +
    shared.platformSubmissions
  const shareOf = (submissions: number) =>
    onShared > 0 ? (shared.sharedCost * submissions) / onShared : 0
  const rows = orgs.map((o) => {
    const usd = o.ownCost + (o.ownJudges ? 0 : shareOf(o.submissions))
    const cost = Math.round(usd * shared.usdRate)
    const revenue = Math.round(o.monthly)
    return {
      id: o.id,
      revenue,
      cost,
      margin: revenue - cost,
      /** Costs more than it pays. */
      losing: cost > revenue,
    }
  })
  return {
    orgs: rows,
    revenue: rows.reduce((n, r) => n + r.revenue, 0),
    cost: rows.reduce((n, r) => n + r.cost, 0),
    /** The shared judges' cost of personal practice and the platform's own work. */
    platformCost: Math.round(
      shareOf(shared.platformSubmissions) * shared.usdRate
    ),
  }
}
