/*
 * The platform's own staff: who may run the platform dashboard and what they may do.
 * Like organizations' roles (permissions.ts): a fixed list of permissions, built-in roles
 * that can't be changed, and custom roles made from the list.
 */

export const PLATFORM_PERMISSIONS = {
  "platform.library.manage": {
    label: "Manage the library",
    description: "Write and edit problems, questions, units, the daily challenge, study plans and notices.",
    module: "Content",
  },
  "platform.library.share": {
    label: "Share content",
    description: "Allot the library's content to colleges, and decide which colleges see it.",
    module: "Content",
  },
  "platform.work.manage": {
    label: "Set work",
    description: "Create and run the platform's assignments, exams and contests.",
    module: "Teaching",
  },
  "platform.gradebook.view": {
    label: "See grades",
    description: "See gradebooks and students' code for the platform's assignments.",
    module: "Teaching",
  },
  "platform.submissions.view": {
    label: "See submissions",
    description: "See every submission and run plagiarism checks.",
    module: "Teaching",
  },
  "platform.orgs.manage": {
    label: "Manage colleges",
    description: "Create, suspend and configure organizations and name their owners.",
    module: "Platform",
  },
  "platform.users.manage": {
    label: "Manage users",
    description: "See accounts, block and unblock them.",
    module: "Platform",
  },
  "platform.settings.manage": {
    label: "Platform settings",
    description: "Features, languages, limits and the site's settings.",
    module: "Platform",
  },
  "platform.roles.manage": {
    label: "Manage staff and roles",
    description: "Give platform roles to people and create roles.",
    module: "Platform",
  },
  "platform.audit.view": {
    label: "See the activity log",
    description: "See who changed what on the platform.",
    module: "Platform",
  },
} as const

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS
export const PLATFORM_PERMISSION_KEYS = Object.keys(
  PLATFORM_PERMISSIONS
) as PlatformPermission[]
export const isPlatformPermission = (value: string): value is PlatformPermission =>
  value in PLATFORM_PERMISSIONS

/** Built-in platform roles. They can't be edited or deleted. */
export const PLATFORM_ROLES = {
  owner: {
    name: "Owner",
    description: "Everything, including making others owners. The platform keeps at least one.",
    permissions: PLATFORM_PERMISSION_KEYS,
  },
  content_admin: {
    name: "Content admin",
    description: "The library, sharing it, and the platform's assignments, contests and grades.",
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
    permissions: ["platform.gradebook.view", "platform.submissions.view"] as PlatformPermission[],
  },
  support: {
    name: "Support",
    description: "Helps people: accounts, colleges, submissions and the activity log.",
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
