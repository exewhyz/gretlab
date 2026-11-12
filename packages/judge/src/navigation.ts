import { ORG_TYPE_CONFIG, ORG_TYPES, type OrgType } from "./org-types.ts"
import type { Permission } from "./permissions.ts"

/*
 * The org dashboard's navigation, as data. Each feature is one entry naming its group, the
 * permissions that reveal it, the org types it applies to, and (optionally) the module that
 * must be enabled for it. The sidebar is rendered from this list, grouped and filtered, so
 * adding a feature or a new org type is an edit here, not new code across components.
 *
 * Core features (no `module`) are always eligible; a feature with a `module` shows only when
 * that module is enabled for the org (tenant-type config). This is what lets a college turn
 * on attendance, timetable, library and the rest while a lean cohort leaves them off.
 */

/** The fixed, named sidebar groups, in order. Every feature belongs to exactly one. */
export const NAV_GROUPS = [
  "Overview",
  "People",
  "Teaching",
  "Content",
  "Reports",
  "Communication",
  "Settings",
] as const
export type NavGroup = (typeof NAV_GROUPS)[number]

export interface NavItem {
  key: string
  label: string
  /** Appended to /orgs/<slug>/manage. */
  path: string
  group: NavGroup
  /** Shown if the viewer holds any of these (empty = always). */
  anyOf: Permission[]
  /** Org types this applies to; omitted = all. */
  orgTypes?: OrgType[]
  /** A toggleable module key; omitted = core, always eligible. */
  module?: string
  /** A different label for some org types (e.g. Groups is \"Classes\" in a school). */
  labels?: Partial<Record<OrgType, string>>
}

/** The current org features, grouped. New modules (attendance, timetable, ...) are added here. */
export const ORG_NAV: NavItem[] = [
  {
    key: "overview",
    label: "Overview",
    path: "",
    group: "Overview",
    anyOf: [],
  },

  {
    key: "members",
    label: "Members",
    path: "/members",
    group: "People",
    anyOf: ["org.members.view", "org.members.invite"],
  },
  {
    key: "groups",
    label: "Groups",
    path: "/groups",
    group: "People",
    anyOf: ["org.members.view", "org.groups.manage"],
    labels: Object.fromEntries(
      ORG_TYPES.map((t) => [t, ORG_TYPE_CONFIG[t].groupsLabel])
    ),
  },
  {
    key: "roles",
    label: "Roles",
    path: "/roles",
    group: "People",
    anyOf: ["org.roles.manage", "org.members.view"],
  },
  {
    key: "invites",
    label: "Invites",
    path: "/invites",
    group: "People",
    anyOf: ["org.members.invite"],
  },
  {
    key: "import",
    label: "Import",
    path: "/import",
    group: "People",
    anyOf: ["org.members.import"],
  },
  {
    key: "parents",
    label: "Parents",
    path: "/parents",
    group: "People",
    anyOf: ["parents.view", "parents.link"],
    module: "parents",
  },

  {
    key: "assignments",
    label: "Assignments",
    path: "/assignments",
    group: "Teaching",
    anyOf: ["assignments.manage", "gradebook.view"],
  },
  {
    key: "subjects",
    label: "Subjects",
    path: "/subjects",
    group: "Teaching",
    anyOf: [
      "subjects.create",
      "subjects.edit",
      "subjects.delete",
      "subjects.assign",
    ],
    module: "subjects",
  },
  {
    key: "timetable",
    label: "Timetable",
    path: "/timetable",
    group: "Teaching",
    anyOf: ["timetable.periods", "timetable.edit"],
    module: "timetable",
  },
  {
    key: "my-timetable",
    label: "My timetable",
    path: "/my-timetable",
    group: "Teaching",
    anyOf: ["teaching.log", "attendance.mark"],
    module: "timetable",
  },
  {
    key: "attendance",
    label: "Attendance",
    path: "/attendance",
    group: "Teaching",
    anyOf: ["attendance.mark", "attendance.view"],
    module: "attendance",
  },
  {
    key: "templates",
    label: "Templates",
    path: "/templates",
    group: "Teaching",
    anyOf: ["assignments.manage"],
  },
  {
    key: "contests",
    label: "Contests",
    path: "/contests",
    group: "Teaching",
    anyOf: ["contests.manage"],
  },

  {
    key: "library",
    label: "Library",
    path: "/library",
    group: "Content",
    anyOf: ["problems.manage", "assignments.manage", "contests.manage"],
  },
  {
    key: "courses",
    label: "Courses",
    path: "/courses",
    group: "Content",
    anyOf: ["problems.manage", "assignments.manage", "contests.manage"],
  },
  {
    key: "problems",
    label: "Problems",
    path: "/problems",
    group: "Content",
    anyOf: ["problems.manage"],
  },
  {
    key: "questions",
    label: "Questions",
    path: "/questions",
    group: "Content",
    anyOf: ["problems.manage"],
  },

  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    group: "Reports",
    anyOf: ["reports.view"],
  },
  {
    key: "attendance-report",
    label: "Attendance report",
    path: "/attendance-report",
    group: "Reports",
    anyOf: ["attendance.view", "attendance.mark"],
    module: "attendance",
  },
  {
    key: "outcomes",
    label: "Outcomes",
    path: "/outcomes",
    group: "Reports",
    anyOf: ["org.outcomes.manage", "assignments.manage", "reports.view"],
  },
  {
    key: "activity",
    label: "Activity",
    path: "/activity",
    group: "Reports",
    anyOf: ["org.audit.view"],
  },

  {
    key: "notices",
    label: "Notices",
    path: "/notes",
    group: "Communication",
    anyOf: ["notices.manage"],
  },
  {
    key: "notifications",
    label: "Notifications",
    path: "/notifications",
    group: "Communication",
    anyOf: ["org.notifications.manage"],
  },

  {
    key: "settings",
    label: "Settings",
    path: "/settings",
    group: "Settings",
    anyOf: ["org.settings.manage"],
  },
  {
    key: "lms",
    label: "LMS (LTI)",
    path: "/lms",
    group: "Settings",
    anyOf: ["org.settings.lms"],
  },
]

export interface NavContext {
  orgType: OrgType
  can: (permission: Permission) => boolean
  /** Enabled toggleable modules; a core feature ignores this. */
  enabledModules?: ReadonlySet<string>
}

export interface NavGroupView {
  group: NavGroup
  items: { key: string; label: string; path: string }[]
}

/** The groups and items a viewer should see, in order; empty groups are dropped. */
export function visibleOrgNav(
  items: NavItem[],
  ctx: NavContext
): NavGroupView[] {
  const out: NavGroupView[] = []
  for (const group of NAV_GROUPS) {
    const visible = items
      .filter(
        (item) =>
          item.group === group &&
          (!item.orgTypes || item.orgTypes.includes(ctx.orgType)) &&
          (!item.module || (ctx.enabledModules?.has(item.module) ?? false)) &&
          (item.anyOf.length === 0 || item.anyOf.some((p) => ctx.can(p)))
      )
      .map((item) => ({
        key: item.key,
        label: item.labels?.[ctx.orgType] ?? item.label,
        path: item.path,
      }))
    if (visible.length) out.push({ group, items: visible })
  }
  return out
}
