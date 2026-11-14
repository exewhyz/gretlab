import { getDb, orgApiKeys, organizations, sql, users } from "@workspace/db"
import { apiKeyMatches, apiKeyPrefix } from "@workspace/judge/integrations"

import { ApiError } from "@/lib/api/errors"

/*
 * Another system calling an organization's API with a key: the key stands for the person who
 * made it, only inside its organization, and only with the permissions chosen for it (the
 * org context narrows its grants to those, features/orgs/server.ts).
 */

const { and, eq, isNull } = sql

const invalid = () =>
  new ApiError(401, "invalid_api_key", "That API key isn't valid, or it was revoked.")

export async function userForApiKey(token: string, path: string) {
  const prefix = apiKeyPrefix(token)
  if (!prefix) throw invalid()
  const db = getDb()
  const [row] = await db
    .select({ key: orgApiKeys, slug: organizations.slug, user: users })
    .from(orgApiKeys)
    .innerJoin(organizations, eq(orgApiKeys.orgId, organizations.id))
    .innerJoin(users, eq(orgApiKeys.createdBy, users.id))
    .where(and(eq(orgApiKeys.prefix, prefix), isNull(orgApiKeys.revokedAt)))
  if (!row || !apiKeyMatches(token, row.key.hash) || row.user.disabled) throw invalid()
  const base = `/api/v1/orgs/${row.slug}`
  if (path !== base && !path.startsWith(`${base}/`))
    throw new ApiError(403, "forbidden", "This key only works on its own organization's API.")
  // Marked used, at most once a minute.
  const last = row.key.lastUsedAt?.getTime() ?? 0
  if (Date.now() - last > 60_000)
    await db
      .update(orgApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(orgApiKeys.id, row.key.id))
  return {
    user: row.user,
    key: {
      id: row.key.id,
      orgId: row.key.orgId,
      name: row.key.name,
      permissions: row.key.permissions,
    },
  }
}
