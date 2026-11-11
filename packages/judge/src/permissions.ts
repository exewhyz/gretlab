/**
 * What a role inside an organization can allow. Roles are bundles of these, stored per
 * organization; the server checks them on every request with `allows`. Add a permission
 * here only together with the server check that enforces it.
 *
 * Some permissions are fine-grained actions under a coarse parent (`parent`): holding the
 * parent grants every action beneath it (`allows` walks up the chain), so a role with
 * "Set assignments" can do all of create/edit/publish/delete/extend/grade, while a role may
 * instead be given just "Grade & feedback". Existing roles keep working unchanged, because
 * they hold the parents. Keep a child's `module` the same as its parent's.
 */
export const PERMISSIONS = {
  "org.members.view": {
    label: "See members",
    description: "See who is in the organization and in which groups.",
    module: "Members",
  },
  "org.members.invite": {
    label: "Invite and approve",
    description:
      'Create invite links and approve requests to join. Grant this, or just "Approve requests" under it.',
    module: "Members",
  },
  "org.members.manage": {
    label: "Manage members",
    description:
      "Move members between groups and remove them from the organization. Grant this, or the finer actions under it.",
    module: "Members",
  },
  "org.groups.manage": {
    label: "Manage groups",
    description:
      "Create, rename and delete groups such as branches, batches or teams. Grant this, or the finer actions under it.",
    module: "Structure",
  },
  "org.roles.manage": {
    label: "Manage roles",
    description:
      'Create and edit roles and decide what each one allows, and give roles to people. Grant this, or just "Assign roles" under it.',
    module: "Structure",
  },
  "org.settings.manage": {
    label: "Organization settings",
    description:
      "The organization's profile and rules: name, description, who can join, group level names, languages. Grant this, or the finer actions under it (LMS, outcomes, notifications).",
    module: "Structure",
  },
  "problems.manage": {
    label: "Write problems",
    description:
      "The organization's own problems and questions: create, edit, publish and delete. Published problems join the public library, credited to the organization. Grant this, or the finer actions under it.",
    module: "Teaching",
  },
  "assignments.manage": {
    label: "Set assignments",
    description:
      "Everything about assignments for the groups this applies to: create, edit, publish, delete, extend and grade. Grant this, or the finer actions under it.",
    module: "Teaching",
  },
  "contests.manage": {
    label: "Run contests",
    description:
      "Everything about contests for the groups this applies to: create, edit, run, delete and grade. Grant this, or the finer actions under it.",
    module: "Teaching",
  },
  "gradebook.view": {
    label: "See grades",
    description:
      "See assignment marks of students in the groups this applies to.",
    module: "Teaching",
  },
  "gradebook.export": {
    label: "Download grades",
    description: "Download gradebooks as CSV.",
    module: "Teaching",
  },
  "notices.manage": {
    label: "Post notices",
    description:
      "Post and remove notices members see on the organization's page. Grant this, or the finer actions under it.",
    module: "Teaching",
  },
  "teaching.log": {
    label: "Log teaching",
    description:
      "Keep the syllabus of the groups this applies to and log the classes taught.",
    module: "Teaching",
  },
  "reports.view": {
    label: "See reports",
    description:
      "Activity, assignment results and teaching progress for the groups this applies to.",
    module: "Reports",
  },
  "org.members.import": {
    label: "Import members",
    description: "Add many people at once from a CSV file.",
    module: "Members",
  },
  "org.audit.view": {
    label: "Activity log",
    description: "See who changed members, roles and settings, and when.",
    module: "Structure",
  },
  "assignments.create": {
    label: "Create assignments",
    description: "Make new assignments and exams.",
    module: "Teaching",
    parent: "assignments.manage",
  },
  "assignments.edit": {
    label: "Edit assignments",
    description: "Change assignments and exams that already exist.",
    module: "Teaching",
    parent: "assignments.manage",
  },
  "assignments.publish": {
    label: "Publish assignments",
    description:
      "Make an assignment or exam visible to students (or hide it again).",
    module: "Teaching",
    parent: "assignments.manage",
  },
  "assignments.delete": {
    label: "Delete assignments",
    description: "Remove assignments and exams.",
    module: "Teaching",
    parent: "assignments.manage",
  },
  "assignments.extend": {
    label: "Give more time",
    description: "Extend a student's due time or reopen problems for them.",
    module: "Teaching",
    parent: "assignments.manage",
  },
  "assignments.grade": {
    label: "Grade & feedback",
    description:
      "Mark answers and projects, comment on code, and release results.",
    module: "Teaching",
    parent: "assignments.manage",
  },
  "contests.create": {
    label: "Create contests",
    description: "Make new contests.",
    module: "Teaching",
    parent: "contests.manage",
  },
  "contests.edit": {
    label: "Edit contests",
    description: "Change contests that already exist.",
    module: "Teaching",
    parent: "contests.manage",
  },
  "contests.delete": {
    label: "Delete contests",
    description: "Remove contests.",
    module: "Teaching",
    parent: "contests.manage",
  },
  "contests.grade": {
    label: "Grade contests",
    description: "Mark contest quiz answers.",
    module: "Teaching",
    parent: "contests.manage",
  },
  "problems.create": {
    label: "Create problems & questions",
    description: "Make new problems and bank questions.",
    module: "Teaching",
    parent: "problems.manage",
  },
  "problems.edit": {
    label: "Edit problems & questions",
    description:
      "Change problems and questions that already exist, and import them.",
    module: "Teaching",
    parent: "problems.manage",
  },
  "problems.publish": {
    label: "Publish problems",
    description: "Publish a problem to the library (or unpublish it).",
    module: "Teaching",
    parent: "problems.manage",
  },
  "problems.delete": {
    label: "Delete problems & questions",
    description: "Remove problems and questions.",
    module: "Teaching",
    parent: "problems.manage",
  },
  "notices.create": {
    label: "Post notices",
    description: "Post notices members see on the organization's page.",
    module: "Teaching",
    parent: "notices.manage",
  },
  "notices.delete": {
    label: "Remove notices",
    description: "Take down notices.",
    module: "Teaching",
    parent: "notices.manage",
  },
  "org.members.groups": {
    label: "Change members' groups",
    description: "Move members between groups.",
    module: "Members",
    parent: "org.members.manage",
  },
  "org.members.remove": {
    label: "Remove members",
    description: "Remove members from the organization.",
    module: "Members",
    parent: "org.members.manage",
  },
  "org.groups.create": {
    label: "Create groups",
    description: "Add branches, batches or teams.",
    module: "Structure",
    parent: "org.groups.manage",
  },
  "org.groups.edit": {
    label: "Rename groups",
    description: "Rename groups and change where they sit.",
    module: "Structure",
    parent: "org.groups.manage",
  },
  "org.groups.delete": {
    label: "Delete groups",
    description: "Remove groups.",
    module: "Structure",
    parent: "org.groups.manage",
  },
  "org.settings.lms": {
    label: "Connect an LMS",
    description:
      "Connect Moodle, Canvas or another LMS and link its courses to classes.",
    module: "Structure",
    parent: "org.settings.manage",
  },
  "org.outcomes.manage": {
    label: "Course outcomes",
    description: "Edit the program and course outcomes and attainment rules.",
    module: "Structure",
    parent: "org.settings.manage",
  },
  "org.members.approve": {
    label: "Approve requests",
    description:
      "Approve or decline requests to join, without creating invite links.",
    module: "Members",
    parent: "org.members.invite",
  },
  "org.notifications.manage": {
    label: "Manage notifications",
    description:
      "Choose which notifications the organization sends its members, within what the platform allows.",
    module: "Structure",
    parent: "org.settings.manage",
  },
  "org.members.assign_roles": {
    label: "Assign roles",
    description:
      "Give people roles and take them away, without editing the roles themselves.",
    module: "Structure",
    parent: "org.roles.manage",
  },
} as const

export type Permission = keyof typeof PERMISSIONS
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[]

/** A permission's parent, or null. Children grant nothing their parent doesn't also grant. */
export function parentPermission(permission: Permission): Permission | null {
  const entry = PERMISSIONS[permission] as { parent?: Permission }
  return entry.parent ?? null
}

/** A permission and every ancestor above it (closest first): holding any of these grants it. */
export function permissionWithAncestors(permission: Permission): Permission[] {
  const chain: Permission[] = [permission]
  for (let p = parentPermission(permission); p; p = parentPermission(p)) {
    chain.push(p)
  }
  return chain
}

/** Whether a set of held permission keys grants `permission` (directly or via an ancestor). */
export function grantsPermission(
  held: readonly string[],
  permission: Permission
): boolean {
  return permissionWithAncestors(permission).some((p) => held.includes(p))
}

/**
 * Whether held keys include `root` or any finer action beneath it. Use it to tell whether
 * someone does a job at all (e.g. "touches assignments": the parent or any of create, edit,
 * grade...), rather than whether they have one exact permission.
 */
export function grantsAnyUnder(
  held: readonly string[],
  root: Permission
): boolean {
  return held.some(
    (p) => isPermission(p) && permissionWithAncestors(p).includes(root)
  )
}

export const isPermission = (value: string): value is Permission =>
  value in PERMISSIONS

/** The roles every organization starts with. They can't be deleted or renamed. */
export const SYSTEM_ROLES = {
  owner: {
    name: "Owner",
    description:
      "Everything, including making others owners. Every organization keeps at least one.",
    permissions: PERMISSION_KEYS,
  },
  admin: {
    name: "Admin",
    description: "Everything except changing owners.",
    permissions: PERMISSION_KEYS,
  },
  teacher: {
    name: "Teacher",
    description:
      "Teaches the groups they're given: members, problems, assignments, contests, grades and notices.",
    permissions: [
      "org.members.view",
      "problems.manage",
      "assignments.manage",
      "contests.manage",
      "gradebook.view",
      "gradebook.export",
      "notices.manage",
      "teaching.log",
      "reports.view",
    ] as Permission[],
  },
  member: {
    name: "Member",
    description: "Belongs to the organization. No management access.",
    permissions: [] as Permission[],
  },
} as const

export type SystemRoleKey = keyof typeof SYSTEM_ROLES

/** One role given to one person, either across the organization or within one group. */
export interface Grant {
  permissions: readonly string[]
  /** null: the whole organization. Otherwise the group and everything under it. */
  groupId: string | null
}

/**
 * Whether these grants allow an action.
 * `targetGroups` is the group the action is about followed by its ancestors, or null for
 * an action about the whole organization, which only an organization-wide grant allows.
 */
export function allows(
  grants: readonly Grant[],
  permission: Permission,
  targetGroups: readonly string[] | null = null
): boolean {
  return grants.some(
    (grant) =>
      grantsPermission(grant.permissions, permission) &&
      (grant.groupId === null ||
        (targetGroups !== null && targetGroups.includes(grant.groupId)))
  )
}

/** Group ids from one group up to the top, using a parent lookup. Stops on cycles. */
export function ancestry(
  groupId: string,
  parentOf: (id: string) => string | null | undefined
): string[] {
  const chain: string[] = []
  let current: string | null | undefined = groupId
  while (current && !chain.includes(current)) {
    chain.push(current)
    current = parentOf(current)
  }
  return chain
}

/** Whether an email's domain is one of the organization's, for joining automatically. */
export function domainMatches(email: string, domains: readonly string[]) {
  const domain = email.toLowerCase().split("@")[1] ?? ""
  return domains.some((allowed) => {
    const d = allowed.toLowerCase().replace(/^@/, "")
    return domain === d || domain.endsWith("." + d)
  })
}

/**
 * Who content is for: conditions that must all hold, each met by being in any one of its
 * groups (or a group inside one). [[3rd Year], [CAC]] is third-year students who also take
 * CAC. No conditions means everyone in the organization.
 */
export type Audience = readonly (readonly string[])[]

/** Every group an audience mentions, for checking they belong to the organization. */
export const audienceGroups = (audience: Audience) => [
  ...new Set(audience.flat()),
]

/**
 * Whether grants allow acting on content for this audience. Everyone it reaches is inside
 * every condition, so covering all groups of any one condition is enough. Content for the
 * whole organization needs an organization-wide grant.
 */
export function allowsFor(
  grants: readonly Grant[],
  permission: Permission,
  audience: Audience,
  chainOf: (groupId: string) => string[]
): boolean {
  const conditions = audience.filter((c) => c.length > 0)
  if (conditions.length === 0) return allows(grants, permission, null)
  return conditions.some((condition) =>
    condition.every((id) => allows(grants, permission, chainOf(id)))
  )
}

/** Whether someone in these groups meets every condition of the audience. */
export function inAudience(
  memberGroups: readonly string[],
  audience: Audience,
  chainOf: (groupId: string) => string[]
): boolean {
  const reach = new Set(memberGroups.flatMap(chainOf))
  return audience.every(
    (condition) =>
      condition.length === 0 || condition.some((id) => reach.has(id))
  )
}
