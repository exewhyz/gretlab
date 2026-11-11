import {
  getDb,
  organizations,
  settings as settingsTable,
  sql,
} from "@workspace/db"
import {
  effectivePolicy,
  NOTIFICATION_EVENT_KEYS,
  readOverrides,
  type NotificationEvent,
  type PolicyOverrides,
} from "@workspace/judge"

import { cached, invalidate } from "@/lib/ttl-cache"

/*
 * Reading who hears about what, at the levels above a person (the rules are in
 * packages/judge/src/notifications.ts): the platform's switches (a row in `settings`), an
 * organization's (`organizations.notifications`). Each level stores only what it turned
 * off, so a new event is on everywhere until someone decides otherwise. The dashboards that
 * change them are in ./policy-admin.ts; this file imports no other feature, so notify() can
 * be called from any of them.
 */

const { eq } = sql

export const PLATFORM_POLICY_KEY = "notifications.policy"
const CACHE_KEY = "notifications.policy"
const CACHE_MS = 5000

/** Only what a level turned off; "on" is the default and isn't stored. */
export function compactOverrides(overrides: PolicyOverrides): PolicyOverrides {
  const out: PolicyOverrides = {}
  for (const event of NOTIFICATION_EVENT_KEYS) {
    const off = Object.fromEntries(
      Object.entries(overrides[event] ?? {}).filter(([, on]) => on === false)
    )
    if (Object.keys(off).length) out[event] = off
  }
  return out
}

export function platformOverrides(): Promise<PolicyOverrides> {
  return cached(CACHE_KEY, CACHE_MS, async () => {
    const [row] = await getDb()
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, PLATFORM_POLICY_KEY))
    return readOverrides(row?.value)
  })
}

export async function orgOverrides(orgId: string): Promise<PolicyOverrides> {
  const [row] = await getDb()
    .select({ value: organizations.notifications })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  return readOverrides(row?.value)
}

/** The policy that applies to an event; `orgId` null for the platform's own work. */
export async function policyFor(
  event: NotificationEvent,
  orgId: string | null
) {
  const [platform, org] = await Promise.all([
    platformOverrides(),
    orgId ? orgOverrides(orgId) : null,
  ])
  return effectivePolicy(event, platform, org)
}

/** After the platform's switches are saved, so this server sees them at once. */
export const forgetPlatformPolicy = () => invalidate(CACHE_KEY)
