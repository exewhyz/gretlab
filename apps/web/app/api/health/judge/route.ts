import { NextResponse } from "next/server"

import { getQueueHealth } from "@/features/admin/server"

export const dynamic = "force-dynamic"

/** A submission waiting longer than this means the judges aren't keeping up. */
const STUCK_SECONDS = 180

/**
 * For uptime monitors: 200 while a code judge (runner) is online and the queue moves, 503
 * otherwise. Separate from /api/health, which load balancers use: a judge outage mustn't
 * take the website out of rotation. Says only whether and why, not hosts or counts.
 */
export async function GET() {
  try {
    const queue = await getQueueHealth()
    const problem =
      queue.runners.length === 0
        ? "no code judge is online"
        : queue.queued > 0 && queue.oldestQueuedSeconds > STUCK_SECONDS
          ? "submissions are waiting more than 3 minutes"
          : null
    return problem
      ? NextResponse.json({ status: "down", problem }, { status: 503 })
      : NextResponse.json({ status: "ok" })
  } catch {
    return NextResponse.json(
      { status: "down", problem: "the database can't be reached" },
      { status: 503 }
    )
  }
}
