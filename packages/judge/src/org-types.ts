/*
 * What each kind of organization is like, and which optional modules it may run. One
 * deployment hosts schools, colleges, cohorts, companies and communities; this table is the
 * only place their differences live: what their group levels are called, what the sidebar
 * calls groups, and which modules they start with. A new kind of organization is a new row.
 *
 * Modules are optional features an organization turns on or off in its settings (attendance,
 * timetable, library...). The org's stored choices override its type's defaults; a module a
 * type can't use is never on. A module not yet `ready` can't be turned on.
 */

export const ORG_TYPES = [
  "school",
  "college",
  "cohort",
  "company",
  "community",
  "other",
] as const
export type OrgType = (typeof ORG_TYPES)[number]

export const isOrgType = (value: string): value is OrgType =>
  (ORG_TYPES as readonly string[]).includes(value)

export interface OrgTypeConfig {
  label: string
  /** Default names of the group levels, top first (editable per org in Settings). */
  groupLevels: string[]
  /** What the sidebar calls the Groups page. */
  groupsLabel: string
  /** Modules on by default for this type. */
  modules: ModuleKey[]
}

export const MODULES = {
  attendance: {
    label: "Attendance",
    description:
      "A daily register for each class or section, and attendance reports.",
    for: ["school", "college", "cohort"],
    ready: false,
  },
  timetable: {
    label: "Timetable",
    description: "Weekly periods for every subject, per class or section.",
    for: ["school", "college"],
    ready: false,
  },
  subjects: {
    label: "Subjects",
    description: "Subjects taught in each class, beyond the coding lab.",
    for: ["school", "college"],
    ready: false,
  },
  parents: {
    label: "Parent accounts",
    description:
      "Parents sign in to follow their children's work, attendance and results.",
    for: ["school", "college", "cohort"],
    ready: false,
  },
  library: {
    label: "Library",
    description: "The catalog of books and who has borrowed what.",
    for: ["school", "college"],
    ready: false,
  },
  transport: {
    label: "Transport",
    description: "Routes, stops and which students ride which route.",
    for: ["school", "college"],
    ready: false,
  },
  hostel: {
    label: "Hostel",
    description: "Hostels, rooms and beds, and who stays where.",
    for: ["school", "college"],
    ready: false,
  },
  finance: {
    label: "Fees and payments",
    description: "Fee plans, invoices and online payments.",
    for: ["school", "college"],
    ready: false,
  },
} as const satisfies Record<
  string,
  {
    label: string
    description: string
    for: readonly OrgType[]
    ready: boolean
  }
>

export type ModuleKey = keyof typeof MODULES
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]
export const isModuleKey = (value: string): value is ModuleKey =>
  value in MODULES

export const ORG_TYPE_CONFIG: Record<OrgType, OrgTypeConfig> = {
  school: {
    label: "School",
    groupLevels: ["Grade", "Section"],
    groupsLabel: "Classes",
    modules: ["attendance", "timetable", "subjects", "parents"],
  },
  college: {
    label: "College",
    groupLevels: ["Branch", "Batch"],
    groupsLabel: "Batches",
    modules: ["attendance", "timetable", "subjects"],
  },
  cohort: {
    label: "Cohort program",
    groupLevels: ["Cohort"],
    groupsLabel: "Cohorts",
    modules: ["attendance"],
  },
  company: {
    label: "Company",
    groupLevels: ["Team"],
    groupsLabel: "Teams",
    modules: [],
  },
  community: {
    label: "Community",
    groupLevels: ["Group"],
    groupsLabel: "Groups",
    modules: [],
  },
  other: {
    label: "Organization",
    groupLevels: ["Group"],
    groupsLabel: "Groups",
    modules: [],
  },
}

/** A module's availability for a type: usable at all, and whether it can be switched on yet. */
export function moduleAvailable(type: OrgType, key: ModuleKey) {
  const m = MODULES[key]
  return (m.for as readonly OrgType[]).includes(type)
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
 * The modules that are on for an organization: its type's defaults, then its own choices,
 * limited to modules its type can use and that are ready.
 */
export function enabledModules(type: OrgType, stored: unknown): Set<ModuleKey> {
  const choices = readModuleChoices(stored)
  const on = new Set<ModuleKey>()
  for (const key of MODULE_KEYS) {
    if (!moduleAvailable(type, key) || !MODULES[key].ready) continue
    const chosen = choices[key]
    if (chosen ?? ORG_TYPE_CONFIG[type].modules.includes(key)) on.add(key)
  }
  return on
}
