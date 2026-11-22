import { randomUUID } from "node:crypto"
import { availableParallelism, hostname, totalmem } from "node:os"

import {
  getDb,
  judgeMachines,
  organizations,
  settings as settingsTable,
  sql,
} from "@workspace/db"
import { QUEUE_CHANNEL, resolveSettings } from "@workspace/judge"
import postgres from "postgres"

import {
  claimNext,
  deregister,
  heartbeat,
  LEASE_MS,
  processSubmission,
  pruneOldRuns,
  rejudgeProvisional,
  retrySystemErrors,
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
/**
 * The fallback when a wake-up is missed. Every path that queues work sends one (pg_notify), and
 * the listener re-checks after reconnecting, so this rarely matters. Kept long: an idle judge
 * polling every second kept the database busy (and billed) around the clock.
 */
const POLL_MS = Number(process.env.RUNNER_POLL_MS ?? 10_000)
const HEARTBEAT_MS = Math.max(1000, Math.floor(LEASE_MS / 3))
const RECOVERY_MS = Math.max(1000, Math.floor(LEASE_MS / 2))
const HOUSEKEEPING_MS = 60 * 60_000
const REJUDGE_CHECK_MS = 60_000
const SHUTDOWN_GRACE_MS = 5 * 60_000

const runnerId = `${hostname()}-${randomUUID().slice(0, 8)}`
const db = getDb()
const backend = backendFromEnv(runnerId)

/**
 * An organization's own judge (RUNNER_POOL: its address, as in /orgs/<address>): it takes that
 * organization's work first, and only that organization's work comes to it while it's online.
 * Unset: a shared judge. An address that isn't an organization stops it starting, rather than
 * letting it quietly run as a shared judge.
 */
const POOL_SLUG = process.env.RUNNER_POOL?.trim() || null
const [poolOrg] = POOL_SLUG
  ? await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql.eq(organizations.slug, POOL_SLUG))
  : []
if (POOL_SLUG && !poolOrg) {
  console.error(
    `[runner] RUNNER_POOL=${POOL_SLUG}: no organization has that address`
  )
  process.exit(1)
}
const pool = poolOrg?.id ?? null

/**
 * A machine started from the dashboard (RUNNER_MACHINE: its AWS instance id). Stop there asks
 * it to drain: it takes no more work, finishes what it has, leaves the judges list (so its
 * organization's work falls back to the shared judges at once), says "drained", and waits for
 * the website to end the machine. It never exits by itself: Docker would restart it.
 */
const MACHINE = process.env.RUNNER_MACHINE?.trim() || null
const DRAIN_CHECK_MS = 10_000
let lastDrainCheck = 0
async function drainAsked() {
  if (!MACHINE || Date.now() - lastDrainCheck < DRAIN_CHECK_MS) return false
  lastDrainCheck = Date.now()
  const [row] = await db
    .select({ stage: judgeMachines.stage })
    .from(judgeMachines)
    .where(sql.eq(judgeMachines.instanceId, MACHINE))
  return ["draining", "drained", "stopping", "stopped"].includes(
    row?.stage ?? ""
  )
}

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

// LISTEN needs a session of its own: a direct connection or a pooler in session mode (Supabase's
// port 5432), never transaction pooling.
const listener = postgres(
  process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  { max: 1, onnotice: () => {} }
)
// The third callback runs on every (re)connect: notifications sent while the connection was down
// are lost, so look at the queue straight away instead of waiting for the next poll.
await listener.listen(QUEUE_CHANNEL, wakeNow, wakeNow)

let stopping = false
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return
    console.log(`[runner] ${signal}: finishing ${running.size} job(s)`)
    stopping = true
    wakeNow()
  })
}

const self = {
  id: runnerId,
  host: hostname(),
  slots: SLOTS,
  poolOrgId: pool,
  version: process.env.RUNNER_VERSION?.trim() || null,
  machineId: MACHINE,
}
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
const rejudging = setInterval(() => {
  retrySystemErrors(db).catch((error) =>
    console.error("[runner] re-judging error:", error)
  )
  void (async () => {
    const rows = await db.select().from(settingsTable)
    const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    await rejudgeProvisional(
      db,
      resolveSettings(stored)["server_execution.enabled"]
    )
  })().catch((error) =>
    console.error("[runner] provisional re-judging error:", error)
  )
}, REJUDGE_CHECK_MS)
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
  `[runner] ${runnerId} started: ${SLOTS} slots, ${MEMORY_BUDGET_MB} MB budget, ${POOL_SLUG ? `pool ${POOL_SLUG}` : "shared"}`
)

/** A single loop claims for every slot, so idle runners poll once, not once per slot. */
let draining = false
while (!stopping) {
  if (await drainAsked().catch(() => false)) {
    console.log(`[runner] asked to drain: finishing ${running.size} job(s)`)
    draining = true
    stopping = true
    break
  }
  if (running.size >= SLOTS) {
    await sleepUntilWoken(POLL_MS)
    continue
  }
  try {
    const job = await claimNext(
      db,
      runnerId,
      MEMORY_BUDGET_MB - usedMemory(),
      pool
    )
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
clearInterval(rejudging)
await deregister(db, runnerId)
await listener.end({ timeout: 2 })
if (draining && MACHINE) {
  await db
    .update(judgeMachines)
    .set({ stage: "drained", note: "", stageAt: new Date() })
    .where(
      sql.and(
        sql.eq(judgeMachines.instanceId, MACHINE),
        sql.eq(judgeMachines.stage, "draining")
      )
    )
  console.log("[runner] drained: waiting for the machine to be ended")
  // Stay alive and idle: exiting would make Docker restart the judge.
  setInterval(() => {}, 1 << 30)
} else {
  console.log("[runner] stopped")
  process.exit(0)
}
