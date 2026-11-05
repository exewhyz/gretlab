import { randomUUID } from "node:crypto"
import { availableParallelism, hostname, totalmem } from "node:os"

import { getDb, settings as settingsTable } from "@workspace/db"
import { QUEUE_CHANNEL, resolveSettings } from "@workspace/judge"
import postgres from "postgres"

import {
  claimNext,
  deregister,
  heartbeat,
  LEASE_MS,
  processSubmission,
  pruneOldRuns,
  releaseExpired,
} from "./queue.ts"
import { backendFromEnv } from "./sandbox/docker.ts"

/**
 * One Docker daemon tops out at about 4-8 useful parallel jobs (see docs/scaling.md), so
 * add machines rather than slots. Set RUNNER_MEMORY_MB on a host shared with anything else.
 */
const SLOTS = Number(
  process.env.RUNNER_CONCURRENCY ?? Math.min(8, availableParallelism())
)
const MEMORY_BUDGET_MB = Number(
  process.env.RUNNER_MEMORY_MB ?? Math.floor(totalmem() / 1024 / 1024) - 1024
)
/** The fallback when a wake-up is missed. Notifications make the usual case instant. */
const POLL_MS = Number(process.env.RUNNER_POLL_MS ?? 1000)
const HEARTBEAT_MS = Math.max(1000, Math.floor(LEASE_MS / 3))
const RECOVERY_MS = Math.max(1000, Math.floor(LEASE_MS / 2))
const HOUSEKEEPING_MS = 60 * 60_000
const SHUTDOWN_GRACE_MS = 5 * 60_000

const runnerId = `${hostname()}-${randomUUID().slice(0, 8)}`
const db = getDb()
const backend = backendFromEnv(runnerId)

// Refuses to start without the promised isolation. See the sandbox rules in AGENTS.md.
await backend.verify()
await backend.sweepOrphans()

const running = new Map<string, number>()
const usedMemory = () => [...running.values()].reduce((a, b) => a + b, 0)

let wake: (() => void) | null = null
let woken = false
const wakeNow = () => {
  woken = true
  wake?.()
}

function sleepUntilWoken(ms: number) {
  return new Promise<void>((resolve) => {
    // A wake-up that arrived since the last claim attempt means there may be work now.
    if (woken) {
      woken = false
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    wake = () => {
      clearTimeout(timer)
      woken = false
      wake = null
      resolve()
    }
  })
}

// Outside any pooler: LISTEN needs a session of its own, which transaction pooling can't give.
const listener = postgres(
  process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  { max: 1, onnotice: () => {} }
)
await listener.listen(QUEUE_CHANNEL, wakeNow)

let stopping = false
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return
    console.log(`[runner] ${signal}: finishing ${running.size} job(s)`)
    stopping = true
    wakeNow()
  })
}

const self = { id: runnerId, host: hostname(), slots: SLOTS }
const tick = () =>
  heartbeat(db, self, [...running.keys()]).catch((error) =>
    console.error("[runner] heartbeat error:", error)
  )

const heartbeats = setInterval(tick, HEARTBEAT_MS)
const recovery = setInterval(() => {
  releaseExpired(db).catch((error) =>
    console.error("[runner] recovery error:", error)
  )
}, RECOVERY_MS)
const housekeeping = setInterval(() => {
  void (async () => {
    const rows = await db.select().from(settingsTable)
    const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    const days = resolveSettings(stored)["submissions.run_retention_days"]
    await pruneOldRuns(db, days)
    await backend.sweepOrphans()
  })().catch((error) => console.error("[runner] housekeeping error:", error))
}, HOUSEKEEPING_MS)

await tick()
console.log(
  `[runner] ${runnerId} started: ${SLOTS} slots, ${MEMORY_BUDGET_MB} MB budget`
)

/** A single loop claims for every slot, so idle runners poll once, not once per slot. */
while (!stopping) {
  if (running.size >= SLOTS) {
    await sleepUntilWoken(POLL_MS)
    continue
  }
  try {
    const job = await claimNext(db, runnerId, MEMORY_BUDGET_MB - usedMemory())
    if (!job) {
      await sleepUntilWoken(POLL_MS)
      continue
    }
    running.set(job.id, job.memoryLimitMb)
    void processSubmission(db, backend, job, runnerId).finally(() => {
      running.delete(job.id)
      wakeNow()
    })
  } catch (error) {
    console.error("[runner] loop error:", error)
    await sleepUntilWoken(2000)
  }
}

const giveUpAt = Date.now() + SHUTDOWN_GRACE_MS
while (running.size && Date.now() < giveUpAt) {
  await sleepUntilWoken(POLL_MS)
}
clearInterval(heartbeats)
clearInterval(recovery)
clearInterval(housekeeping)
await deregister(db, runnerId)
await listener.end({ timeout: 2 })
console.log("[runner] stopped")
process.exit(0)
