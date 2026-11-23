import { timingSafeEqual } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { jobsHealth, runJobs } from "@/features/jobs/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/*
 * Runs background jobs for most of a minute and says how many are still waiting. Called by
 * apps/worker whenever a job is queued (it listens for them), so jobs start at once even with
 * nobody waiting on the page; the email cron and the uptime check also run them. Same secret
 * as the email cron (CRON_SECRET); it can only run jobs that are already queued.
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
  if (expected.length < 16) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "CRON_SECRET isn't set on this server (or is under 16 characters).",
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
  const { steps } = await runJobs(45_000)
  const { waiting } = await jobsHealth()
  return NextResponse.json({ steps, waiting })
}

export const POST = handle
