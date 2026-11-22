import {
  getDb,
  judgeMachines,
  organizations,
  runners,
  sql,
  users,
  type User,
} from "@workspace/db"
import { RUNNER_ONLINE_MS, SETTINGS } from "@workspace/judge"
import { z } from "zod"

import { ApiError } from "@/lib/api/errors"
import { writePlatformAudit } from "@/features/platform/staff"
import { getSettings, updateSettings } from "@/features/settings/server"

import { machines } from "./machines"

/*
 * Judge machines from the dashboard (Dashboard › Judges): start one for the shared pool or for
 * an organization, watch it come up, stop it. The machine reports its own setting-up stages
 * (deploy/judge-machine-boot.sh) and drains when asked (apps/runner/src/main.ts); this module
 * starts and ends machines on AWS (./machines.ts) and keeps each row's stage true to AWS
 * (reconcileJudges, also run by the email cron, so a drained machine is ended even when nobody
 * has the page open).
 */

const { and, desc, eq, gt, inArray, notInArray } = sql

type Stage = (typeof judgeMachines.$inferSelect)["stage"]

/** Stages of a machine that exists (or is about to): these count toward the limit. */
const LIVE: Stage[] = [
  "requested",
  "launching",
  "installing",
  "ready",
  "draining",
  "drained",
  "stopping",
]

function needMachines() {
  const provider = machines()
  if (!provider) {
    throw new ApiError(
      503,
      "not_configured",
      "Judge machines can't be started from this copy of GretLab (no AWS role is set)."
    )
  }
  return provider
}

async function setStage(id: string, stage: Stage, note = "") {
  await getDb()
    .update(judgeMachines)
    .set({ stage, note, stageAt: new Date() })
    .where(eq(judgeMachines.id, id))
}

/** Everything the Judges page shows. */
export async function listJudges() {
  const db = getDb()
  const settings = await getSettings()
  const [rows, online] = await Promise.all([
    db
      .select({
        id: judgeMachines.id,
        instanceId: judgeMachines.instanceId,
        size: judgeMachines.size,
        stage: judgeMachines.stage,
        note: judgeMachines.note,
        createdAt: judgeMachines.createdAt,
        stageAt: judgeMachines.stageAt,
        pool: { slug: organizations.slug, name: organizations.name },
        requestedBy: users.name,
      })
      .from(judgeMachines)
      .leftJoin(organizations, eq(organizations.id, judgeMachines.poolOrgId))
      .leftJoin(users, eq(users.id, judgeMachines.requestedBy))
      .orderBy(desc(judgeMachines.createdAt))
      .limit(100),
    db
      .select({
        host: runners.host,
        slots: runners.slots,
        busy: runners.busy,
        pool: organizations.slug,
      })
      .from(runners)
      .leftJoin(organizations, eq(organizations.id, runners.poolOrgId))
      .where(gt(runners.lastSeenAt, new Date(Date.now() - RUNNER_ONLINE_MS))),
  ])
  return {
    machines: rows.map((row) => ({
      ...row,
      pool: row.pool?.slug ? row.pool : null,
    })),
    /** Every judge reporting in, started here or not (a hand-set-up server too). */
    online,
    settings: {
      maxRunning: settings["judges.max_running"],
      size: settings["judges.size"],
    },
    /** Whether this copy can start machines at all. */
    available: machines() !== null,
    sizes: Object.entries(SETTINGS["judges.size"].choices).map(
      ([value, label]) => ({
        value,
        label,
      })
    ),
  }
}

export const startSchema = z.object({
  /** An organization's address, for its own judge; left out for a shared one. */
  pool: z.string().trim().max(100).optional(),
})

export async function startJudge(
  user: User,
  input: z.infer<typeof startSchema>
) {
  const provider = needMachines()
  const db = getDb()
  const settings = await getSettings()
  let poolOrg: { id: string; slug: string; name: string } | null = null
  if (input.pool) {
    ;[poolOrg = null] = await db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
      })
      .from(organizations)
      .where(eq(organizations.slug, input.pool))
    if (!poolOrg)
      throw new ApiError(404, "not_found", "No organization has that address.")
  }
  // The limit, checked and the row written in one transaction under a lock, so two people
  // pressing Start together can't both pass it.
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql.sql`select pg_advisory_xact_lock(hashtext('judge_machines'))`
    )
    const [{ live } = { live: 0 }] = await tx
      .select({ live: sql.count() })
      .from(judgeMachines)
      .where(inArray(judgeMachines.stage, LIVE))
    if (live >= settings["judges.max_running"]) {
      throw new ApiError(
        409,
        "judge_limit",
        `${live} judge machines are already running or starting; the limit is ${settings["judges.max_running"]}. Stop one, or raise the limit.`
      )
    }
    const [created] = await tx
      .insert(judgeMachines)
      .values({
        poolOrgId: poolOrg?.id ?? null,
        size: settings["judges.size"],
        requestedBy: user.id,
      })
      .returning()
    return created!
  })
  await writePlatformAudit(
    user,
    "judges.start",
    `Started a judge machine for ${poolOrg ? poolOrg.name : "everyone (shared)"}`,
    { machine: row.id, pool: poolOrg?.slug ?? null, size: row.size }
  )
  try {
    const instanceId = await provider.start({
      size: row.size,
      pool: poolOrg?.slug ?? null,
      rowId: row.id,
    })
    await db
      .update(judgeMachines)
      .set({ instanceId, stage: "launching", stageAt: new Date() })
      .where(eq(judgeMachines.id, row.id))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await setStage(
      row.id,
      "failed",
      `AWS refused to start it: ${reason}`.slice(0, 500)
    )
  }
  const [saved] = await db
    .select()
    .from(judgeMachines)
    .where(eq(judgeMachines.id, row.id))
  return saved!
}

/**
 * Stop: a machine still setting up is ended at once; a ready one drains first (finishes its
 * work, takes no more), and reconcileJudges ends it once it says it's drained.
 */
export async function stopJudge(user: User, id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new ApiError(404, "not_found", "No such judge machine.")
  const db = getDb()
  const [row] = await db
    .select()
    .from(judgeMachines)
    .where(eq(judgeMachines.id, id))
  if (!row) throw new ApiError(404, "not_found", "No such judge machine.")
  if (
    !["requested", "launching", "installing", "ready", "failed"].includes(
      row.stage
    )
  ) {
    throw new ApiError(
      409,
      "already_stopping",
      "This machine is already stopping or stopped."
    )
  }
  if (row.stage === "ready") {
    await setStage(
      row.id,
      "draining",
      "Finishing the work it has, then it ends"
    )
  } else if (row.stage === "failed") {
    // A failed machine may still be running (it failed while setting up) or may be gone.
    if (row.instanceId)
      await needMachines()
        .end(row.instanceId)
        .catch(() => {})
    await setStage(row.id, "stopped", row.note)
  } else if (row.instanceId) {
    await needMachines().end(row.instanceId)
    await setStage(row.id, "stopping")
  } else {
    await setStage(row.id, "stopped")
  }
  await writePlatformAudit(user, "judges.stop", "Stopped a judge machine", {
    machine: row.id,
    instance: row.instanceId,
  })
  const [saved] = await db
    .select()
    .from(judgeMachines)
    .where(eq(judgeMachines.id, id))
  return saved!
}

/**
 * Keeps every row true to AWS: a drained machine is ended, an ended one is stopped (or failed,
 * if nobody asked it to stop). Cheap when nothing is live; never throws.
 */
export async function reconcileJudges() {
  const provider = machines()
  if (!provider) return { ended: 0, updated: 0 }
  const db = getDb()
  const live = await db
    .select()
    .from(judgeMachines)
    .where(
      and(
        inArray(judgeMachines.stage, LIVE),
        notInArray(judgeMachines.stage, ["requested"])
      )
    )
  const withIds = live.filter((row) => row.instanceId)
  if (withIds.length === 0) return { ended: 0, updated: 0 }
  let ended = 0
  let updated = 0
  try {
    const states = await provider.states(withIds.map((row) => row.instanceId!))
    for (const row of withIds) {
      const state = states.get(row.instanceId!)
      const gone = !state || state === "terminated" || state === "shutting-down"
      if (gone) {
        const asked = row.stage === "stopping" || row.stage === "drained"
        await setStage(
          row.id,
          asked ? "stopped" : "failed",
          asked ? "" : "The machine stopped without being asked to"
        )
        updated++
      } else if (row.stage === "drained") {
        await provider.end(row.instanceId!)
        await setStage(row.id, "stopping")
        ended++
      }
    }
  } catch (error) {
    console.error("[judges] reconcile:", error)
  }
  return { ended, updated }
}

export const settingsSchema = z.object({
  maxRunning: SETTINGS["judges.max_running"].schema,
  size: SETTINGS["judges.size"].schema,
})

export async function saveJudgeSettings(
  user: User,
  input: z.infer<typeof settingsSchema>
) {
  await updateSettings({
    "judges.max_running": input.maxRunning,
    "judges.size": input.size,
  })
  await writePlatformAudit(user, "judges.settings", "Changed judge settings", {
    changes: [
      { field: "Judges at once", to: input.maxRunning },
      { field: "Machine size", to: input.size },
    ],
  })
  return { maxRunning: input.maxRunning, size: input.size }
}
