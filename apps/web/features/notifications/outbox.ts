import { emailOutbox, getDb, sql } from "@workspace/db"
import { afterFailure, OUTBOX_STUCK_SECONDS } from "@workspace/judge"

import {
  mailEnabled,
  mailer,
  mailFrom,
  type Mail,
  type SendResult,
} from "./mailer"

/*
 * The email outbox: a queue in Postgres, so it works on any host.
 *
 *   notify()  ──► queueEmails(tx)        rows written in the same transaction as the
 *                                        notifications: both are stored or neither is
 *             ──► after(drainOutbox)     sent right after the response (Next.js after())
 *   scheduler ──► /api/cron/outbox       finishes big batches and retries (any scheduler:
 *                                        Vercel Cron, cron on a server, GitHub Actions)
 *
 * drainOutbox() claims a provider-sized batch with FOR UPDATE SKIP LOCKED, so drains
 * running at once never take the same email, sends it, and records each result: sent,
 * retry later with backoff, or failed (rules in packages/judge/src/outbox.ts). A drain stops
 * before its time budget, so a serverless function is never killed mid-batch; a send that
 * was cut off anyway is reclaimed after OUTBOX_STUCK_SECONDS. Delivery is at least once,
 * and providers get a stable id per email to drop duplicates. Sent rows are deleted after
 * a week, failed ones after a month.
 */

const { eq, inArray } = sql

type Executor = Pick<ReturnType<typeof getDb>, "insert">

export interface QueuedEmail {
  to: string
  subject: string
  text: string
}

/** Queues emails inside the caller's transaction. Without a provider, nothing is queued. */
export async function queueEmails(tx: Executor, emails: QueuedEmail[]) {
  if (!mailEnabled() || emails.length === 0) return
  await tx.insert(emailOutbox).values(
    emails.map((e) => ({
      to: e.to,
      subject: e.subject.slice(0, 300),
      text: e.text.slice(0, 10_000),
    }))
  )
}

type Claimed = {
  id: string
  to_address: string
  subject: string
  body: string
  attempts: number
} & Record<string, unknown>

function claim(limit: number) {
  return getDb().execute<Claimed>(sql.sql`
    UPDATE email_outbox
    SET status = 'sending', claimed_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM email_outbox
      WHERE (status = 'queued' AND next_attempt_at <= now())
         OR (status = 'sending' AND claimed_at < now() - make_interval(secs => ${OUTBOX_STUCK_SECONDS}))
      ORDER BY next_attempt_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, to_address, subject, body, attempts
  `)
}

export interface DrainResult {
  sent: number
  retrying: number
  failed: number
}

/** Records what happened to each email of a batch. */
async function record(
  rows: Claimed[],
  results: SendResult[],
  done: DrainResult
) {
  const db = getDb()
  const sentIds = rows.filter((_, i) => results[i]?.ok).map((row) => row.id)
  if (sentIds.length) {
    await db
      .update(emailOutbox)
      .set({ status: "sent", sentAt: sql.sql`now()`, lastError: null })
      .where(inArray(emailOutbox.id, sentIds))
    done.sent += sentIds.length
  }
  for (const [i, row] of rows.entries()) {
    const result = results[i] ?? {
      ok: false as const,
      permanent: false,
      error: "no result from the provider",
    }
    if (result.ok) continue
    const next = afterFailure(row.attempts, result.permanent)
    await db
      .update(emailOutbox)
      .set(
        next.retry
          ? {
              status: "queued",
              lastError: result.error,
              nextAttemptAt: sql.sql`now() + make_interval(secs => ${next.inSeconds})`,
            }
          : { status: "failed", lastError: result.error }
      )
      .where(eq(emailOutbox.id, row.id))
    if (next.retry) done.retrying++
    else done.failed++
    console.error(
      `[outbox] ${next.retry ? `retry in ${next.inSeconds}s` : `gave up (${next.reason})`}: ${result.error}`
    )
  }
}

/** Sends what's due for up to `budgetMs`. Safe to run anywhere, any number at once. */
export async function drainOutbox(budgetMs = 25_000): Promise<DrainResult> {
  const done: DrainResult = { sent: 0, retrying: 0, failed: 0 }
  const provider = mailer()
  if (!provider) return done
  const stopAt = Date.now() + budgetMs
  // Leave room for the last batch: a provider call can take up to ~15 s.
  while (Date.now() < stopAt - 15_000) {
    const rows = await claim(provider.batchSize)
    if (rows.length === 0) break
    const mails: Mail[] = rows.map((row) => ({
      id: row.id,
      to: row.to_address,
      subject: row.subject,
      text: row.body,
    }))
    await record(rows, await provider.send(mailFrom(), mails), done)
  }
  await tidy()
  return done
}

/** Keeps no copy of mail for long: sent rows after a week, failed after a month. */
async function tidy() {
  await getDb().execute(sql.sql`
    DELETE FROM email_outbox WHERE id IN (
      SELECT id FROM email_outbox
      WHERE (status = 'sent' AND sent_at < now() - interval '7 days')
         OR (status = 'failed' AND created_at < now() - interval '30 days')
      LIMIT 1000
    )`)
}

/** For /api/metrics. */
export async function outboxHealth() {
  const [row] = await getDb().execute<{
    queued: string
    failed: string
    oldest_seconds: string | null
  }>(sql.sql`
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'sending')) AS queued,
      count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '1 day') AS failed,
      EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE status IN ('queued', 'sending'))) AS oldest_seconds
    FROM email_outbox
  `)
  return {
    queued: Number(row?.queued ?? 0),
    failedLastDay: Number(row?.failed ?? 0),
    oldestQueuedSeconds: Math.round(Number(row?.oldest_seconds ?? 0)),
  }
}
