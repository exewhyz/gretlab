import { emailOutbox, getDb, sql } from "@workspace/db"
import {
  afterFailure,
  isUndeliverable,
  OUTBOX_STUCK_SECONDS,
} from "@workspace/judge"

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
 *
 * Urgent email (sign-in codes, security notices) is claimed ahead of the rest, so a
 * backlog of notices never delays a code, and sendUrgent() sends only urgent email, at
 * once, for a request that's waiting on it. Email with `expiresAt` (a code) is dropped
 * rather than sent late.
 */

const { eq, inArray } = sql

type Executor = Pick<ReturnType<typeof getDb>, "insert">

export interface QueuedEmail {
  to: string
  subject: string
  text: string
  /** The branded version (features/emails); the text goes with it for plain-text readers. */
  html?: string
}

export interface QueueOptions {
  /** Ahead of everything else (sign-in codes, security notices). */
  urgent?: boolean
  /** Don't send it after this long (a code that will have expired). */
  expiresInMs?: number
}

/** Queues emails inside the caller's transaction. Without a provider, nothing is queued. */
export async function queueEmails(
  tx: Executor,
  emails: QueuedEmail[],
  options: QueueOptions = {}
) {
  // Students who don't sign in have an address on .invalid: never mail it.
  emails = emails.filter((e) => !isUndeliverable(e.to))
  if (!mailEnabled() || emails.length === 0) return
  const expiresAt = options.expiresInMs
    ? new Date(Date.now() + options.expiresInMs)
    : null
  await tx.insert(emailOutbox).values(
    emails.map((e) => ({
      to: e.to,
      subject: e.subject.slice(0, 300),
      text: e.text.slice(0, 10_000),
      html: e.html ? e.html.slice(0, 200_000) : null,
      urgent: options.urgent ?? false,
      expiresAt,
    }))
  )
}

type Claimed = {
  id: string
  to_address: string
  subject: string
  body: string
  html: string | null
  attempts: number
} & Record<string, unknown>

/** Takes a batch to send: urgent first, then oldest; only urgent when asked. */
function claim(limit: number, onlyUrgent = false) {
  return getDb().execute<Claimed>(sql.sql`
    UPDATE email_outbox
    SET status = 'sending', claimed_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM email_outbox
      WHERE ((status = 'queued' AND next_attempt_at <= now())
         OR (status = 'sending' AND claimed_at < now() - make_interval(secs => ${OUTBOX_STUCK_SECONDS})))
        AND (expires_at IS NULL OR expires_at > now())
        AND (${onlyUrgent} = false OR urgent)
      ORDER BY urgent DESC, next_attempt_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, to_address, subject, body, html, attempts
  `)
}

/** Email past its use (a code that expired while waiting) is dropped, not sent late. */
function dropExpired() {
  return getDb().execute(sql.sql`
    UPDATE email_outbox SET status = 'failed', last_error = 'expired before it could be sent'
    WHERE status IN ('queued', 'sending') AND expires_at <= now()
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
  await dropExpired()
  // Leave room for the last batch: a provider call can take up to ~15 s.
  while (Date.now() < stopAt - 15_000) {
    if (!(await sendBatch(provider, false, done))) break
  }
  await tidy()
  return done
}

/** Claims and sends one batch; false when there was nothing to send. */
async function sendBatch(
  provider: NonNullable<ReturnType<typeof mailer>>,
  onlyUrgent: boolean,
  done: DrainResult
) {
  const rows = await claim(provider.batchSize, onlyUrgent)
  if (rows.length === 0) return false
  const mails: Mail[] = rows.map((row) => ({
    id: row.id,
    to: row.to_address,
    subject: row.subject,
    text: row.body,
    ...(row.html ? { html: row.html } : {}),
  }))
  await record(rows, await provider.send(mailFrom(), mails), done)
  return true
}

/**
 * Sends the urgent email waiting (a sign-in code just queued), now, for a request that
 * waits on it. Ordinary email is left to drainOutbox, so a backlog never slows this.
 */
export async function sendUrgent(): Promise<DrainResult> {
  const done: DrainResult = { sent: 0, retrying: 0, failed: 0 }
  const provider = mailer()
  if (!provider) return done
  await dropExpired()
  // A few batches at most: urgent email is a code or two, not a mailing.
  for (let i = 0; i < 3; i++) {
    if (!(await sendBatch(provider, true, done))) break
  }
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
