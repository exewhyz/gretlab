/*
 * The platform's own staff: who may run the platform dashboard and what they may do.
 * Like organizations' roles (permissions.ts): a fixed list of permissions, built-in roles
 * that can't be changed, and custom roles made from the list.
 */

export const PLATFORM_PERMISSIONS = {
  "platform.library.manage": {
    label: "Manage the library",
    description:
      "The library's own problems and questions: create, edit, publish and delete (and units, the daily challenge, study plans and notices). Grant this, or the finer actions under it.",
    module: "Content",
  },
  "platform.library.share": {
    label: "Share content",
    description:
      "Allot the library's content to colleges, and decide which colleges see it.",
    module: "Content",
  },
  "platform.work.manage": {
    label: "Set work",
    description:
      "The platform's assignments, exams and contests: create, edit, publish, delete, extend and grade. Grant this, or the finer actions under it.",
    module: "Teaching",
  },
  "platform.gradebook.view": {
    label: "See grades",
    description:
      "See gradebooks and students' code for the platform's assignments.",
    module: "Teaching",
  },
  "platform.submissions.view": {
    label: "See submissions",
    description: "See every submission and run plagiarism checks.",
    module: "Teaching",
  },
  "platform.orgs.manage": {
    label: "Manage organizations",
    description:
      "Create schools, colleges and other organizations and name their owners, approve sign-ups, and suspend or reactivate them. Grant this, or the finer actions under it.",
    module: "Platform",
  },
  "platform.kinds.manage": {
    label: "Manage organization kinds",
    description:
      "Decide, for each kind of organization (school, college, cohort…), which modules are off, optional, or on from the start. Applies to every organization of that kind at once.",
    module: "Platform",
  },
  "platform.users.manage": {
    label: "Manage users",
    description: "See accounts, block and unblock them.",
    module: "Platform",
  },
  "platform.settings.manage": {
    label: "Platform settings",
    description:
      "The site's own settings: features and limits. Grant this, or the finer actions under it (languages, notifications).",
    module: "Platform",
  },
  "platform.roles.manage": {
    label: "Manage staff and roles",
    description:
      'Create and edit platform roles, and give them to people. Grant this, or just "Assign staff roles" under it.',
    module: "Platform",
  },
  "platform.audit.view": {
    label: "See the activity log",
    description: "See who changed what on the platform.",
    module: "Platform",
  },
  "platform.library.create": {
    label: "Create problems & questions",
    description: "Make new library problems and bank questions.",
    module: "Content",
    parent: "platform.library.manage",
  },
  "platform.library.edit": {
    label: "Edit problems & questions",
    description: "Change library problems and questions, and import them.",
    module: "Content",
    parent: "platform.library.manage",
  },
  "platform.library.delete": {
    label: "Delete problems & questions",
    description: "Remove library problems and questions.",
    module: "Content",
    parent: "platform.library.manage",
  },
  "platform.work.create": {
    label: "Create work",
    description: "Make new platform assignments, exams and contests.",
    module: "Teaching",
    parent: "platform.work.manage",
  },
  "platform.work.edit": {
    label: "Edit work",
    description: "Change platform assignments, exams and contests.",
    module: "Teaching",
    parent: "platform.work.manage",
  },
  "platform.work.delete": {
    label: "Delete work",
    description: "Remove platform assignments, exams and contests.",
    module: "Teaching",
    parent: "platform.work.manage",
  },
  "platform.work.extend": {
    label: "Give more time",
    description: "Extend a student's due time on platform work.",
    module: "Teaching",
    parent: "platform.work.manage",
  },
  "platform.work.grade": {
    label: "Grade & feedback",
    description:
      "Mark answers and projects, comment on code, and release results for platform work.",
    module: "Teaching",
    parent: "platform.work.manage",
  },
  "platform.orgs.create": {
    label: "Create organizations",
    description: "Add a school, college or other organization and name its first owner.",
    module: "Platform",
    parent: "platform.orgs.manage",
  },
  "platform.orgs.suspend": {
    label: "Suspend organizations",
    description: "Suspend an organization, bring it back, or approve one that signed up.",
    module: "Platform",
    parent: "platform.orgs.manage",
  },
  "platform.roles.assign": {
    label: "Assign staff roles",
    description:
      "Give platform roles to people and take them away, without editing the roles themselves.",
    module: "Platform",
    parent: "platform.roles.manage",
  },
  "platform.languages.manage": {
    label: "Manage languages",
    description: "Turn programming languages on or off and tune their limits.",
    module: "Platform",
    parent: "platform.settings.manage",
  },
  "platform.notifications.manage": {
    label: "Manage notifications",
    description: "Choose which notifications the whole site may send.",
    module: "Platform",
    parent: "platform.settings.manage",
  },
} as const

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS
export const PLATFORM_PERMISSION_KEYS = Object.keys(
  PLATFORM_PERMISSIONS
) as PlatformPermission[]
export const isPlatformPermission = (
  value: string
): value is PlatformPermission => value in PLATFORM_PERMISSIONS

/** A platform permission's parent, or null. */
export function platformParent(
  permission: PlatformPermission
): PlatformPermission | null {
  const entry = PLATFORM_PERMISSIONS[permission] as {
    parent?: PlatformPermission
  }
  return entry.parent ?? null
}

/** A platform permission and every ancestor above it (closest first). */
export function platformWithAncestors(
  permission: PlatformPermission
): PlatformPermission[] {
  const chain: PlatformPermission[] = [permission]
  for (let p = platformParent(permission); p; p = platformParent(p))
    chain.push(p)
  return chain
}

/** Whether held platform keys grant `permission`, directly or through an ancestor. */
export function grantsPlatformPermission(
  held: readonly string[],
  permission: PlatformPermission
): boolean {
  return platformWithAncestors(permission).some((p) => held.includes(p))
}

/** Held platform keys plus every finer action they grant, for showing the right UI. */
export function expandPlatformPermissions(
  held: readonly string[]
): PlatformPermission[] {
  return PLATFORM_PERMISSION_KEYS.filter((p) =>
    grantsPlatformPermission(held, p)
  )
}

/** Built-in platform roles. They can't be edited or deleted. */
export const PLATFORM_ROLES = {
  owner: {
    name: "Owner",
    description:
      "Everything, including making others owners. The platform keeps at least one.",
    permissions: PLATFORM_PERMISSION_KEYS,
  },
  content_admin: {
    name: "Content admin",
    description:
      "The library, sharing it, and the platform's assignments, contests and grades.",
    permissions: [
      "platform.library.manage",
      "platform.library.share",
      "platform.work.manage",
      "platform.gradebook.view",
      "platform.submissions.view",
    ] as PlatformPermission[],
  },
  reviewer: {
    name: "Reviewer",
    description: "Looks, doesn't change: grades and submissions.",
    permissions: [
      "platform.gradebook.view",
      "platform.submissions.view",
    ] as PlatformPermission[],
  },
  support: {
    name: "Support",
    description:
      "Helps people: accounts, organizations, submissions and the activity log.",
    permissions: [
      "platform.users.manage",
      "platform.orgs.manage",
      "platform.submissions.view",
      "platform.audit.view",
    ] as PlatformPermission[],
  },
} as const

export type PlatformRoleKey = keyof typeof PLATFORM_ROLES
export const isPlatformRoleKey = (value: string): value is PlatformRoleKey =>
  value in PLATFORM_ROLES

/**
 * Whether someone holding `held` may give a role with `wanted`: never more than they
 * hold, and only owners make owners.
 */
export function mayGrantPlatformRole(
  held: readonly PlatformPermission[],
  wanted: readonly PlatformPermission[],
  wantedIsOwner: boolean,
  holderIsOwner: boolean
) {
  if (wantedIsOwner && !holderIsOwner) return false
  return wanted.every((p) => held.includes(p))
}
