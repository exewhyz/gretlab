/*
 * What the docs know about the app, read from the app's own rules (@workspace/judge), so
 * reference tables and feature pages can't drift from the code.
 */
import {
  KINDS,
  MODULES,
  PERMISSIONS,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  SYSTEM_ROLES,
} from "@workspace/judge"

export { KINDS, MODULES, PERMISSIONS, PLATFORM_PERMISSIONS, PLATFORM_ROLES, SYSTEM_ROLES }

type Info = { label: string; description: string; module?: string; parent?: string }

/** An organization or platform permission by key, or undefined. */
export function permissionInfo(key: string): (Info & { platform: boolean }) | undefined {
  const org = (PERMISSIONS as Record<string, Info>)[key]
  if (org) return { ...org, platform: false }
  const platform = (PLATFORM_PERMISSIONS as Record<string, Info>)[key]
  if (platform) return { ...platform, platform: true }
  return undefined
}

export const isPermissionKey = (key: string) => permissionInfo(key) !== undefined

export const isModuleKey = (key: string) => key in MODULES

/** The kinds of organization, in the app's order. */
export const kinds = Object.values(KINDS) as (typeof KINDS)[keyof typeof KINDS][]

/** Which kinds can use a module, and which start with it on. */
export function moduleKinds(key: string) {
  return {
    can: kinds.filter((k) => (k.capabilities as readonly string[]).includes(key)),
    onByDefault: kinds.filter((k) => (k.defaults as readonly string[]).includes(key)),
  }
}

/** A kind in the plural, as a sentence says it: "colleges", "companies", "other organizations". */
export function kindPlural(label: string) {
  const lower = label.toLowerCase()
  if (lower === "other") return "other organizations"
  if (lower.endsWith("y")) return `${lower.slice(0, -1)}ies`
  return `${lower}s`
}

/** "schools, colleges and cohort programs" */
export function listKinds(list: { label: string }[]) {
  const names = list.map((k) => kindPlural(k.label))
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

/** The demo password every demo account signs in with (packages/db/src/demo). */
export const DEMO_PASSWORD = "Gretlab demo 2026"
