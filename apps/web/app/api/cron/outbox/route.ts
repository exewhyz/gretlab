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

/** Spaces or a line break pasted around a secret don't count. */
const configuredSecret = () => (process.env.CRON_SECRET ?? "").trim()

function tokenMatches(request: NextRequest, expected: string) {
  const given = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim()
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handle(request: NextRequest) {
  const expected = configuredSecret()
  // Says which side is wrong, so a scheduler's log is enough to fix it. Whether a secret is
  // set reveals nothing about it.
  if (expected.length < 16) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "CRON_SECRET isn't set on this server (or is under 16 characters). Set it and redeploy.",
      },
      { status: 503 }
    )
  }
  if (!tokenMatches(request, expected)) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "The Bearer token doesn't match this server's CRON_SECRET.",
      },
      { status: 401 }
    )
  }
  const done = await drainOutbox()
  return NextResponse.json({ ...done, ...(await outboxHealth()) })
}

export const GET = handle
export const POST = handle
