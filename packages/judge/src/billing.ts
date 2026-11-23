/*
 * Plans and prices (apps/web/features/billing): each feature has a price per student per year,
 * set by platform staff; an organization picks features, students, staff and extras, and a
 * period (month, semester or year). Pure and unit-tested (billing.test.ts); the price builder in
 * the browser and the server use these same functions, so what's shown is what's charged.
 * Amounts are whole rupees (an invoice rounds once, at the end).
 */

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
