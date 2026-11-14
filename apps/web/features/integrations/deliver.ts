import { getDb, orgWebhooks, sql, webhookDeliveries } from "@workspace/db"
import {
  eventMatches,
  signWebhook,
  WEBHOOK_MAX_ATTEMPTS,
  webhookRetryAt,
} from "@workspace/judge/integrations"

/*
 * Webhook deliveries: queued with the audit entry that caused them (same transaction), sent
 * once the request is answered, retried with backoff by the scheduled job until they land or
 * run out of attempts. Each is a POST of JSON, signed with the webhook's secret.
 */

const { and, eq, inArray, lte } = sql

type Inserter = Pick<ReturnType<typeof getDb>, "insert">

/** Queues this event for each of the organization's webhooks that wants it; whether any did. */
export async function queueWebhooks(
  tx: Inserter,
  orgId: string,
  payload: { event: string } & Record<string, unknown>
) {
  const hooks = await getDb()
    .select({ id: orgWebhooks.id, events: orgWebhooks.events })
    .from(orgWebhooks)
    .where(and(eq(orgWebhooks.orgId, orgId), eq(orgWebhooks.active, true)))
  const wanted = hooks.filter((h) => eventMatches(h.events, payload.event))
  if (wanted.length === 0) return false
  await tx.insert(webhookDeliveries).values(
    wanted.map((h) => ({
      webhookId: h.id,
      event: payload.event,
      payload: { ...payload, organization: orgId },
    }))
  )
  return true
}

/**
 * Sends what's due, a batch at a time. Each delivery is leased first (its next try pushed two
 * minutes on) so a second sender running at once skips it.
 */
export async function deliverDueWebhooks(limit = 25) {
  const db = getDb()
  const leased = await db.execute<{ id: string }>(sql.sql`
    update webhook_deliveries set next_attempt_at = now() + interval '2 minutes'
    where id in (
      select id from webhook_deliveries
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id`)
  const ids = [...leased].map((r) => r.id)
  if (ids.length === 0) return { sent: 0, failed: 0 }
  const rows = await db
    .select({ d: webhookDeliveries, hook: orgWebhooks })
    .from(webhookDeliveries)
    .innerJoin(orgWebhooks, eq(webhookDeliveries.webhookId, orgWebhooks.id))
    .where(inArray(webhookDeliveries.id, ids))
  let sent = 0
  let failed = 0
  await Promise.all(
    rows.map(async ({ d, hook }) => {
      const body = JSON.stringify({ id: d.id, ...d.payload })
      const now = new Date()
      let status: number | null = null
      let error: string | null = null
      try {
        const res = await fetch(hook.url, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
          headers: {
            "content-type": "application/json",
            "user-agent": "Gretlab-Webhooks/1",
            "gretlab-event": d.event,
            "gretlab-delivery": d.id,
            "gretlab-signature": signWebhook(hook.secret, body, now),
          },
          body,
        })
        status = res.status
        if (!res.ok) error = `HTTP ${res.status}`
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 200) : "Couldn't connect"
      }
      const attempts = d.attempts + 1
      const done = error === null
      if (done) sent++
      else failed++
      await db
        .update(webhookDeliveries)
        .set({
          attempts,
          responseStatus: status,
          lastError: error,
          status: done ? "sent" : attempts >= WEBHOOK_MAX_ATTEMPTS ? "failed" : "pending",
          nextAttemptAt: done ? now : webhookRetryAt(attempts, now),
        })
        .where(eq(webhookDeliveries.id, d.id))
    })
  )
  return { sent, failed }
}

/** Deliveries waiting now (for the scheduled job's report). */
export async function webhooksWaiting() {
  const [row] = await getDb()
    .select({ n: sql.count() })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, new Date())))
  return Number(row?.n ?? 0)
}
