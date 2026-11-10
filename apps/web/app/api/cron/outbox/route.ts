import { timingSafeEqual } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { drainOutbox, outboxHealth } from "@/features/notifications/outbox"

export const dynamic = "force-dynamic"
/** The drain stops itself after 25 s; this is the host's hard limit around it. */
export const maxDuration = 60

/*
 * Sends queued email: big batches and retries that the drain right after a notification
 * didn't finish (features/notifications/outbox.ts). Any scheduler can call it with
 * `Authorization: Bearer <CRON_SECRET>`: Vercel Cron sends exactly that header, and so can
 * cron on a server or a scheduled GitHub Actions run. The token can do nothing but send mail
 * that's already queued. Without a CRON_SECRET of 16+ characters it's off.
 */

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET ?? ""
  if (expected.length < 16) return false
  const given =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const done = await drainOutbox()
  return NextResponse.json({ ...done, ...(await outboxHealth()) })
}

export const GET = handle
export const POST = handle
