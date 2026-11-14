import {
  getDb,
  orgApiKeys,
  orgWebhooks,
  sql,
  users,
  webhookDeliveries,
  type User,
} from "@workspace/db"
import { AUDIT_CATEGORIES, PERMISSIONS, type Permission } from "@workspace/judge"
import {
  newApiKey,
  newWebhookSecret,
  webhookUrlProblem,
} from "@workspace/judge/integrations"
import { z } from "zod"

import {
  canFor,
  needFor,
  orgContext,
  writeAudit,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"
import { requestInfo } from "@/lib/api/request-context"

import { deliverDueWebhooks, queueWebhooks } from "./deliver"

/*
 * Manage › Integrations: an organization's API keys and webhooks. Whoever runs its settings
 * across the organization keeps them. A key can only carry permissions its maker holds across
 * the organization, and can't make more keys or webhooks (those need a signed-in person).
 */

const { and, desc, eq, inArray, isNull } = sql

async function managerContext(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (requestInfo().apiKey)
    throw new ApiError(403, "forbidden", "Keys and webhooks are managed by a person, not a key.")
  needFor(ctx, "org.settings.manage", [])
  return ctx
}

export const keySchema = z.object({
  name: z.string().trim().min(1, "Name the key after what uses it.").max(80),
  permissions: z.array(z.string()).min(1, "Choose what the key may do.").max(200),
})

export const webhookSchema = z.object({
  url: z.string().trim().min(1, "Enter the address.").max(500),
  events: z.array(z.string().trim().min(1).max(80)).min(1, "Choose what to send.").max(50),
})

const allowLocal = () => process.env.WEBHOOKS_ALLOW_LOCAL === "true"

export async function listIntegrations(slug: string, user: User) {
  const ctx = await managerContext(slug, user)
  const db = getDb()
  const [keys, hooks] = await Promise.all([
    db
      .select({ key: orgApiKeys, maker: users.name, makerEmail: users.email })
      .from(orgApiKeys)
      .innerJoin(users, eq(orgApiKeys.createdBy, users.id))
      .where(eq(orgApiKeys.orgId, ctx.org.id))
      .orderBy(desc(orgApiKeys.createdAt)),
    db
      .select()
      .from(orgWebhooks)
      .where(eq(orgWebhooks.orgId, ctx.org.id))
      .orderBy(desc(orgWebhooks.createdAt)),
  ])
  const recent = hooks.length
    ? await db
        .select()
        .from(webhookDeliveries)
        .where(inArray(webhookDeliveries.webhookId, hooks.map((h) => h.id)))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(200)
    : []
  // What a key may be given: what its maker holds across the organization.
  const grantable = (Object.keys(PERMISSIONS) as Permission[]).filter((p) =>
    canFor(ctx, p, [])
  )
  return {
    keys: keys.map(({ key, maker, makerEmail }) => ({
      id: key.id,
      name: key.name,
      prefix: `glk_${key.prefix}_…`,
      permissions: key.permissions,
      madeBy: maker ?? makerEmail,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
    })),
    webhooks: hooks.map((h) => {
      const mine = recent.filter((d) => d.webhookId === h.id)
      return {
        id: h.id,
        url: h.url,
        events: h.events,
        active: h.active,
        createdAt: h.createdAt,
        deliveries: mine.slice(0, 10).map((d) => ({
          id: d.id,
          event: d.event,
          status: d.status,
          attempts: d.attempts,
          responseStatus: d.responseStatus,
          lastError: d.lastError,
          createdAt: d.createdAt,
        })),
      }
    }),
    grantable,
    /** Areas a webhook can ask for ("member.*"), by name. */
    areas: Object.entries(AUDIT_CATEGORIES).map(([key, label]) => ({ key, label })),
  }
}

export async function createApiKey(slug: string, user: User, input: z.infer<typeof keySchema>) {
  const ctx = await managerContext(slug, user)
  const bad = input.permissions.find(
    (p) => !(p in PERMISSIONS) || !canFor(ctx, p as Permission, [])
  )
  if (bad)
    throw new ApiError(
      400,
      "not_yours",
      `A key can only do what you can across the organization; "${PERMISSIONS[bad as Permission]?.label ?? bad}" isn't one of those.`
    )
  const key = newApiKey()
  const [row] = await getDb()
    .insert(orgApiKeys)
    .values({
      orgId: ctx.org.id,
      name: input.name,
      prefix: key.prefix,
      hash: key.hash,
      permissions: input.permissions,
      createdBy: user.id,
    })
    .returning({ id: orgApiKeys.id })
  await writeAudit(ctx, "integration.key_create", `Made the API key "${input.name}"`, {
    permissions: input.permissions,
  })
  // The only time the whole key is shown.
  return { id: row!.id, token: key.token }
}

export async function revokeApiKey(slug: string, user: User, id: string) {
  const ctx = await managerContext(slug, user)
  if (!z.uuid().safeParse(id).success) throw notFound("Key not found")
  const [row] = await getDb()
    .update(orgApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(orgApiKeys.id, id), eq(orgApiKeys.orgId, ctx.org.id), isNull(orgApiKeys.revokedAt)))
    .returning({ name: orgApiKeys.name })
  if (!row) throw notFound("Key not found")
  await writeAudit(ctx, "integration.key_revoke", `Revoked the API key "${row.name}"`)
}

export async function createWebhook(slug: string, user: User, input: z.infer<typeof webhookSchema>) {
  const ctx = await managerContext(slug, user)
  const problem = webhookUrlProblem(input.url, allowLocal())
  if (problem) throw new ApiError(400, "bad_url", problem)
  const secret = newWebhookSecret()
  const [row] = await getDb()
    .insert(orgWebhooks)
    .values({ orgId: ctx.org.id, url: input.url, events: input.events, secret, createdBy: user.id })
    .returning({ id: orgWebhooks.id })
  await writeAudit(ctx, "integration.webhook_create", `Added a webhook to ${new URL(input.url).host}`, {
    events: input.events,
  })
  // The signing secret, shown once.
  return { id: row!.id, secret }
}

export async function updateWebhook(
  slug: string,
  user: User,
  id: string,
  input: { active?: boolean; events?: string[] }
) {
  const ctx = await managerContext(slug, user)
  if (!z.uuid().safeParse(id).success) throw notFound("Webhook not found")
  const [row] = await getDb()
    .update(orgWebhooks)
    .set({
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.events ? { events: input.events } : {}),
    })
    .where(and(eq(orgWebhooks.id, id), eq(orgWebhooks.orgId, ctx.org.id)))
    .returning({ url: orgWebhooks.url, active: orgWebhooks.active })
  if (!row) throw notFound("Webhook not found")
  await writeAudit(
    ctx,
    "integration.webhook_update",
    `${row.active ? "Turned on" : "Paused"} the webhook to ${new URL(row.url).host}`
  )
}

export async function deleteWebhook(slug: string, user: User, id: string) {
  const ctx = await managerContext(slug, user)
  if (!z.uuid().safeParse(id).success) throw notFound("Webhook not found")
  const [row] = await getDb()
    .delete(orgWebhooks)
    .where(and(eq(orgWebhooks.id, id), eq(orgWebhooks.orgId, ctx.org.id)))
    .returning({ url: orgWebhooks.url })
  if (!row) throw notFound("Webhook not found")
  await writeAudit(ctx, "integration.webhook_delete", `Removed the webhook to ${new URL(row.url).host}`)
}

/** Sends a "ping" to one webhook now, to check the address and the receiver's signature check. */
export async function pingWebhook(slug: string, user: User, id: string) {
  const ctx = await managerContext(slug, user)
  const [hook] = await getDb()
    .select({ id: orgWebhooks.id })
    .from(orgWebhooks)
    .where(and(eq(orgWebhooks.id, id), eq(orgWebhooks.orgId, ctx.org.id)))
  if (!hook) throw notFound("Webhook not found")
  await getDb().insert(webhookDeliveries).values({
    webhookId: hook.id,
    event: "ping",
    payload: { event: "ping", at: new Date().toISOString(), organization: ctx.org.id, summary: "A test from Gretlab" },
  })
  await deliverDueWebhooks()
}

export { queueWebhooks }
