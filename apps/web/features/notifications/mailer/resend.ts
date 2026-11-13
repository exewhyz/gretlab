import { createHash } from "node:crypto"

import { permanentHttp } from "@workspace/judge"

import type { Mail, Mailer, SendResult } from "./types"

/*
 * Resend over HTTPS (https://resend.com/docs/api-reference): up to 100 emails per request,
 * a default limit of 10 requests a second per team. Each request carries an
 * Idempotency-Key derived from the outbox ids, so a retry of a request that actually went
 * through returns the first answer instead of sending again (keys last 24 hours).
 *
 * Resend doesn't document whether one invalid email fails a whole batch, so if a batch is
 * refused as invalid, its emails are sent one by one: one bad address can't hold back the
 * rest, and only it fails.
 */

const TIMEOUT_MS = 15_000

interface Answer {
  status: number | null
  error: string
}

export function resendMailer(apiKey: string, baseUrl: string): Mailer {
  async function post(
    path: string,
    body: unknown,
    key: string
  ): Promise<Answer> {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.ok) return { status: response.status, error: "" }
      const detail = await response.text().catch(() => "")
      return {
        status: response.status,
        error: `Resend ${response.status}: ${detail.slice(0, 300)}`,
      }
    } catch (error) {
      return { status: null, error: `Resend unreachable: ${String(error)}` }
    }
  }

  const payload = (from: string, mail: Mail) => ({
    from,
    to: [mail.to],
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  })

  const result = (answer: Answer): SendResult =>
    answer.error
      ? {
          ok: false,
          permanent: permanentHttp(answer.status),
          error: answer.error,
        }
      : { ok: true }

  return {
    name: "resend",
    batchSize: 100,
    async send(from, mails) {
      if (mails.length === 0) return []
      const ids = mails
        .map((m) => m.id)
        .sort()
        .join(",")
      const key = `batch-${createHash("sha256").update(ids).digest("hex")}`
      const batch = await post(
        "/emails/batch",
        mails.map((m) => payload(from, m)),
        key
      )
      // Accepted, or a failure that would hit every email alike (rate limit, outage, key).
      if (!batch.error || !permanentHttp(batch.status)) {
        return mails.map(() => result(batch))
      }
      // Refused as invalid: find which, one by one.
      const results: SendResult[] = []
      for (const mail of mails) {
        results.push(
          result(await post("/emails", payload(from, mail), `email-${mail.id}`))
        )
      }
      return results
    },
  }
}
