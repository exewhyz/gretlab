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
  readKindPolicy,
  type KindPolicy,
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
  const [policies, counts] = await Promise.all([
    kindPolicies(),
    getDb()
      .select({ type: organizations.type, n: count() })
      .from(organizations)
      .groupBy(organizations.type),
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
