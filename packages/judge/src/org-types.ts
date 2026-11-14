import { KINDS, type KindTerms, type ModuleLevel } from "./kinds/index.ts"

/*
 * Kinds of organization and the optional modules they may run. Everything about a kind
 * (its words, levels, capabilities, defaults, role names) lives in its file in ./kinds;
 * this module derives what the rest of the code reads from there.
 *
 * Which modules an organization has is decided in three layers:
 *   1. the kind's capabilities (./kinds): a module a kind can't support is never on;
 *   2. the platform's policy for the kind (platform staff, Admin › Organization kinds):
 *      each capable module is off, optional, or on by default for that kind;
 *   3. the organization's own choices (Settings › Modules), within what's optional or default.
 * A module not yet `ready` is never on.
 */

/** Every kind, in the order offered. Must match the keys of KINDS and the org_type enum. */
export const ORG_TYPES = [
  "school",
  "college",
  "coaching",
  "cohort",
  "company",
  "community",
  "other",
] as const
export type OrgType = (typeof ORG_TYPES)[number]

export const isOrgType = (value: string): value is OrgType =>
  (ORG_TYPES as readonly string[]).includes(value)

export type { KindTerms, ModuleLevel }
export { KINDS }

/** A kind's words: Students or Learners, Classes or Cohorts. */
export const kindTerms = (type: OrgType): KindTerms => KINDS[type].terms

export interface OrgTypeConfig {
  label: string
  /** Default names of the group levels, top first (editable per org in Settings). */
  groupLevels: string[]
  /** What the sidebar calls the Groups page. */
  groupsLabel: string
  /** Modules on by default for this type (before the platform's policy). */
  modules: ModuleKey[]
}

export const MODULES = {
  coding: {
    label: "Coding lab",
    description:
      "Programming assignments, lab exams and contests, judged by running students' code, with the problem and question library and templates.",
    ready: true,
  },
  records: {
    label: "Student records",
    description:
      "Academic years, admission numbers and each student's record, with their class for each year.",
    ready: true,
  },
  exams: {
    label: "Exams and report cards",
    description:
      "Term exams with marks for every subject, grades, results by class and printable report cards. Needs Student records and Subjects.",
    ready: true,
  },
  admissions: {
    label: "Admissions",
    description:
      "Parents apply online; the office reviews, waitlists or admits, and admitting creates the student's record and links the parent. Needs Student records.",
    ready: true,
  },
  leave: {
    label: "Leave",
    description:
      "Students (or their parents) and staff ask for leave; class teachers and the office approve it. Approved student leave is excused in attendance.",
    ready: true,
  },
  staffAttendance: {
    label: "Staff attendance",
    description:
      "A daily register of teachers and staff, self check-in with a late time, approved leave shown, and a monthly report.",
    ready: true,
  },
  attendance: {
    label: "Attendance",
    description:
      "A daily register for each class or section, and attendance reports.",
    ready: true,
  },
  timetable: {
    label: "Timetable",
    description: "Weekly periods for every subject, per class or section.",
    ready: true,
  },
  subjects: {
    label: "Subjects",
    description: "Subjects taught in each class, beyond the coding lab.",
    ready: true,
  },
  parents: {
    label: "Parent accounts",
    description:
      "Parents sign in to follow their children's work, attendance and results.",
    ready: true,
  },
  library: {
    label: "Library",
    description: "The catalog of books and who has borrowed what.",
    ready: true,
  },
  transport: {
    label: "Transport",
    description: "Routes, stops and which students ride which route.",
    ready: true,
  },
  hostel: {
    label: "Hostel",
    description: "Hostels, rooms and beds, and who stays where.",
    ready: true,
  },
  events: {
    label: "Events",
    description:
      "Meetups, workshops and talks, in person or online, with places, a waitlist when full and who's coming. On calendars and in reminders.",
    ready: true,
  },
  training: {
    label: "Assigned training",
    description:
      "Courses assigned to teams with due dates, renewed every few months for compliance, with who's done, overdue or expiring, and certificates that expire.",
    ready: true,
  },
  finance: {
    label: "Fees and payments",
    description: "Fee plans, invoices and online payments.",
    ready: false,
  },
} as const satisfies Record<
  string,
  {
    label: string
    description: string
    ready: boolean
  }
>

export type ModuleKey = keyof typeof MODULES
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]
export const isModuleKey = (value: string): value is ModuleKey =>
  value in MODULES

/** Each kind's basics, derived from its definition (for code that predates ./kinds). */
export const ORG_TYPE_CONFIG = Object.fromEntries(
  ORG_TYPES.map((t) => [
    t,
    {
      label: KINDS[t].label,
      groupLevels: [...KINDS[t].groupLevels],
      groupsLabel: KINDS[t].terms.groups,
      modules: KINDS[t].defaults.filter(isModuleKey),
    },
  ])
) as Record<OrgType, OrgTypeConfig>

/** The platform's per-kind decisions: a level for any of the kind's modules. */
export type KindPolicy = Partial<Record<ModuleKey, ModuleLevel>>

/** Whether a kind can support a module at all. */
export const kindCan = (type: OrgType, key: ModuleKey) =>
  (KINDS[type].capabilities as readonly string[]).includes(key)

/** A module's level for a kind: what the platform set, else the kind's own default. */
export function moduleLevel(
  type: OrgType,
  key: ModuleKey,
  policy?: KindPolicy | null
): ModuleLevel {
  if (!kindCan(type, key)) return "off"
  const set = policy?.[key]
  if (set === "off" || set === "optional" || set === "default") return set
  return (KINDS[type].defaults as readonly string[]).includes(key)
    ? "default"
    : "optional"
}

/** Whether an organization of this kind may switch a module on (capable, allowed, ready). */
export const moduleAvailable = (
  type: OrgType,
  key: ModuleKey,
  policy?: KindPolicy | null
) => MODULES[key].ready && moduleLevel(type, key, policy) !== "off"

/** A stored policy cleaned up: only modules the kind can use, at known levels. */
export function readKindPolicy(type: OrgType, stored: unknown): KindPolicy {
  if (!stored || typeof stored !== "object") return {}
  const out: KindPolicy = {}
  for (const [key, value] of Object.entries(stored)) {
    if (
      isModuleKey(key) &&
      kindCan(type, key) &&
      (value === "off" || value === "optional" || value === "default")
    )
      out[key] = value
  }
  return out
}

/** Stored per-org choices: only known modules, as on/off. Anything else is ignored. */
export function readModuleChoices(
  stored: unknown
): Partial<Record<ModuleKey, boolean>> {
  if (!stored || typeof stored !== "object") return {}
  const out: Partial<Record<ModuleKey, boolean>> = {}
  for (const [key, value] of Object.entries(stored)) {
    if (isModuleKey(key) && typeof value === "boolean") out[key] = value
  }
  return out
}

/**
 * The modules that are on for an organization: within what its kind can support and the
 * platform allows for the kind, its own choices, else the level's default.
 */
export function enabledModules(
  type: OrgType,
  stored: unknown,
  policy?: KindPolicy | null
): Set<ModuleKey> {
  const choices = readModuleChoices(stored)
  const on = new Set<ModuleKey>()
  for (const key of MODULE_KEYS) {
    if (!MODULES[key].ready) continue
    const level = moduleLevel(type, key, policy)
    if (level === "off") continue
    if (choices[key] ?? level === "default") on.add(key)
  }
  return on
}
