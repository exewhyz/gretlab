import {
  getDb,
  orgKindPolicies,
  organizations,
  sql,
  type User,
} from "@workspace/db"
import {
  enabledModules,
  KINDS,
  kindCan,
  MODULE_KEYS,
  MODULES,
  moduleLevel,
  ORG_TYPES,
  isPermission,
  readKindPolicy,
  readRoleTemplates,
  roleTemplatesFor,
  type KindPolicy,
  type RoleTemplate,
  type ModuleKey,
  type OrgType,
} from "@workspace/judge"
import { z } from "zod"

import { platformCan } from "@/features/platform/access"
import { writePlatformAudit } from "@/features/platform/staff"
import { ApiError, notFound } from "@/lib/api/errors"
import { cached, invalidate } from "@/lib/ttl-cache"

/*
 * The platform's decisions about kinds of organization (Admin › Organization kinds): for
 * each kind, which of the modules it can support are off, optional, or on from the start.
 * Read on every request through a short cache, cleared when they change, so every
 * organization of the kind follows a change at once. The kinds themselves are defined in
 * packages/judge/src/kinds.
 */

const KEY = "org-kind-policies"
const { count } = sql

/** Every kind's policy (an empty one where the platform hasn't decided anything). */
export function kindPolicies(): Promise<Record<OrgType, KindPolicy>> {
  return cached(KEY, 30_000, async () => {
    const rows = await getDb().select().from(orgKindPolicies)
    return Object.fromEntries(
      ORG_TYPES.map((t) => [
        t,
        readKindPolicy(t, rows.find((r) => r.kind === t)?.modules),
      ])
    ) as Record<OrgType, KindPolicy>
  })
}

const ROLES_KEY = "org-kind-role-templates"

/** Each kind's suggested roles: the platform's list where it set one, else the default. */
export function kindRoleTemplates(): Promise<Record<OrgType, RoleTemplate[]>> {
  return cached(ROLES_KEY, 30_000, async () => {
    const rows = await getDb()
      .select({ kind: orgKindPolicies.kind, roles: orgKindPolicies.roleTemplates })
      .from(orgKindPolicies)
    return Object.fromEntries(
      ORG_TYPES.map((t) => [t, roleTemplatesFor(t, rows.find((r) => r.kind === t)?.roles)])
    ) as Record<OrgType, RoleTemplate[]>
  })
}

/** The modules on for an organization, under its kind's policy. */
export async function modulesOf(org: { type: OrgType; modules: unknown }) {
  return enabledModules(org.type, org.modules, (await kindPolicies())[org.type])
}

/** For an organization's settings: each module its kind may have, with the platform's level. */
export async function moduleOptions(type: OrgType) {
  const policy = (await kindPolicies())[type]
  // Modules not ready yet are listed too, so Settings can show them as coming soon.
  return MODULE_KEYS.filter((k) => kindCan(type, k))
    .map((key) => ({ key, level: moduleLevel(type, key, policy) }))
    .filter((m) => m.level !== "off")
}

async function needKinds(user: User) {
  if (!(await platformCan(user, "platform.kinds.manage")))
    throw new ApiError(
      403,
      "forbidden",
      "Managing organization kinds isn't part of your role."
    )
}

/** Admin › Organization kinds: every kind, what it is, and each module's level. */
export async function kindsOverview(user: User) {
  await needKinds(user)
  const [policies, counts, roles, stored] = await Promise.all([
    kindPolicies(),
    getDb()
      .select({ type: organizations.type, n: count() })
      .from(organizations)
      .groupBy(organizations.type),
    kindRoleTemplates(),
    getDb().select({ kind: orgKindPolicies.kind, roles: orgKindPolicies.roleTemplates }).from(orgKindPolicies),
  ])
  return {
    modules: MODULE_KEYS.map((key) => ({
      key,
      label: MODULES[key].label,
      description: MODULES[key].description,
      ready: MODULES[key].ready,
    })),
    kinds: ORG_TYPES.map((t) => {
      const k = KINDS[t]
      return {
        key: t,
        label: k.label,
        description: k.description,
        examples: k.examples,
        decides: k.decides,
        terms: k.terms,
        groupLevels: k.groupLevels,
        organizations: Number(counts.find((c) => c.type === t)?.n ?? 0),
        roles: roles[t],
        /** Whether the platform changed the default list. */
        rolesChanged: stored.some((r) => r.kind === t && r.roles != null),
        levels: Object.fromEntries(
          MODULE_KEYS.map((key) => [
            key,
            kindCan(t, key) ? moduleLevel(t, key, policies[t]) : null,
          ])
        ) as Record<ModuleKey, "off" | "optional" | "default" | null>,
      }
    }),
  }
}

export const kindPolicySchema = z.object({
  modules: z.record(z.string(), z.enum(["off", "optional", "default"])),
})

/** Sets a kind's module levels (only modules the kind can support). */
export async function saveKindPolicy(
  user: User,
  kind: string,
  input: z.infer<typeof kindPolicySchema>
) {
  await needKinds(user)
  if (!(ORG_TYPES as readonly string[]).includes(kind))
    throw notFound("No such kind")
  const type = kind as OrgType
  const bad = Object.keys(input.modules).find(
    (k) =>
      !(MODULE_KEYS as string[]).includes(k) || !kindCan(type, k as ModuleKey)
  )
  if (bad)
    throw new ApiError(
      400,
      "not_capable",
      `${KINDS[type].label} can't run ${MODULES[bad as ModuleKey]?.label ?? bad}.`
    )
  const before = (await kindPolicies())[type]
  const next = { ...before, ...readKindPolicy(type, input.modules) }
  await getDb()
    .insert(orgKindPolicies)
    .values({
      kind: type,
      modules: next,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: orgKindPolicies.kind,
      set: { modules: next, updatedBy: user.id, updatedAt: new Date() },
    })
  invalidate(KEY)
  const changed = Object.entries(input.modules)
    .filter(([k, v]) => moduleLevel(type, k as ModuleKey, before) !== v)
    .map(
      ([k, v]) =>
        `${MODULES[k as ModuleKey].label} ${v === "default" ? "on by default" : v}`
    )
  if (changed.length)
    await writePlatformAudit(
      user,
      "platform.kind_policy",
      `${KINDS[type].label}: ${changed.join(", ")}`,
      {
        kind: type,
      }
    )
  return kindsOverview(user)
}

export const kindRolesSchema = z.object({
  /** The whole list; null puts the default back. */
  roles: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_]{2,40}$/, "Use lowercase letters, digits and _"),
        name: z.string().trim().min(1, "Name the role").max(60),
        description: z.string().max(300).default(""),
        permissions: z.array(z.string()).max(200),
        scope: z.enum(["organization", "group"]),
      })
    )
    .max(40)
    .nullable(),
})

/**
 * Sets a kind's suggested roles (or puts the default back). New organizations of the kind
 * start with them; existing ones are offered those they don't have. Roles already made
 * stay as they are.
 */
export async function saveKindRoles(user: User, kind: string, input: z.infer<typeof kindRolesSchema>) {
  await needKinds(user)
  if (!(ORG_TYPES as readonly string[]).includes(kind)) throw notFound("No such kind")
  const type = kind as OrgType
  if (input.roles) {
    const names = input.roles.map((r) => r.name.toLowerCase())
    if (new Set(names).size !== names.length) throw new ApiError(400, "duplicate", "Two roles have the same name.")
    if (new Set(input.roles.map((r) => r.key)).size !== input.roles.length)
      throw new ApiError(400, "duplicate", "Two roles have the same key.")
    const bad = input.roles.flatMap((r) => r.permissions).find((p) => !isPermission(p))
    if (bad) throw new ApiError(400, "bad_permission", `Unknown permission: ${bad}`)
    const builtIn = Object.values(KINDS[type].roleNames).map((n) => n.toLowerCase())
    const clash = input.roles.find((r) => builtIn.includes(r.name.toLowerCase()))
    if (clash) throw new ApiError(400, "built_in", `"${clash.name}" is a built-in role's name.`)
  }
  const roles = input.roles ? readRoleTemplates(input.roles) : null
  await getDb()
    .insert(orgKindPolicies)
    .values({ kind: type, modules: {}, roleTemplates: roles, updatedBy: user.id, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: orgKindPolicies.kind,
      set: { roleTemplates: roles, updatedBy: user.id, updatedAt: new Date() },
    })
  invalidate(ROLES_KEY)
  await writePlatformAudit(
    user,
    "platform.kind_roles",
    roles ? `${KINDS[type].label}: suggested roles set (${roles.map((r) => r.name).join(", ") || "none"})` : `${KINDS[type].label}: suggested roles back to the default`,
    { kind: type }
  )
  return kindsOverview(user)
}
