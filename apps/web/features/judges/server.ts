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

import { machines, type CheckResult, type Machines } from "./machines"

/** The judges' own database login, limited to judging (migration 0081, docs/machines.md). */
export const JUDGE_LOGIN = "gretlab_judge"

/*
 * Judge machines from the dashboard (Dashboard › Judges): start one for the shared pool or for
 * an organization, watch it come up, update it to newer code, stop it. The machine reports its
 * own setting-up stages (deploy/judge-machine-boot.sh) and drains when asked
 * (apps/runner/src/main.ts); this module starts and ends machines on AWS (./machines.ts) and
 * keeps each row true to AWS (reconcileJudges, also run by the email cron, so a drained machine
 * is ended and an update moves on even when nobody has the page open).
 *
 * Updating is replacing: a fresh machine with the latest code for the same pool; once it's
 * ready, the old one drains and ends. One machine at a time, so capacity never drops, and a
 * replacement that fails leaves the old machine working.
 */

const { and, asc, desc, eq, gt, inArray, isNotNull, lt, notInArray } = sql

type Stage = (typeof judgeMachines.$inferSelect)["stage"]
type Machine = typeof judgeMachines.$inferSelect

/** Stages of a machine that exists (or is about to): these count toward the limit. */
export const LIVE: Stage[] = [
  "requested",
  "launching",
  "installing",
  "ready",
  "draining",
  "drained",
  "stopping",
]
/** Still coming up: a replacement in one of these is an update in progress. */
export const COMING_UP: Stage[] = ["requested", "launching", "installing"]
/** A machine that hasn't finished setting up after this long has failed. */
const SETUP_LIMIT_MS = 30 * 60_000

/** The code the site runs: judges set up from another commit are out of date. */
export const latestVersion = () =>
  process.env.JUDGES_LATEST_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || null

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

export async function setStage(id: string, stage: Stage, note = "") {
  await getDb()
    .update(judgeMachines)
    .set({ stage, note, stageAt: new Date() })
    .where(eq(judgeMachines.id, id))
}

const idOrNotFound = (id: string) => {
  if (!z.uuid().safeParse(id).success)
    throw new ApiError(404, "not_found", "No such judge machine.")
}

async function machineOrNotFound(id: string) {
  idOrNotFound(id)
  const [row] = await getDb()
    .select()
    .from(judgeMachines)
    .where(eq(judgeMachines.id, id))
  if (!row) throw new ApiError(404, "not_found", "No such judge machine.")
  return row
}

const onlineSince = () => new Date(Date.now() - RUNNER_ONLINE_MS)

/** Everything the Judges page shows. */
export async function listJudges() {
  const db = getDb()
  const settings = await getSettings()
  const latest = latestVersion()
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
        replacesId: judgeMachines.replacesId,
        updateWanted: judgeMachines.updateWanted,
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
        version: runners.version,
        machineId: runners.machineId,
        login: runners.login,
        pool: organizations.slug,
      })
      .from(runners)
      .leftJoin(organizations, eq(organizations.id, runners.poolOrgId))
      .where(gt(runners.lastSeenAt, onlineSince())),
  ])
  const judgeOn = new Map(
    online.filter((r) => r.machineId).map((r) => [r.machineId!, r])
  )
  const outOfDate = (version: string | null) =>
    Boolean(latest && version && version !== latest)
  return {
    machines: rows.map((row) => {
      const judge = row.instanceId ? judgeOn.get(row.instanceId) : undefined
      return {
        ...row,
        pool: row.pool?.slug ? row.pool : null,
        /** The judge on this machine, while it reports in. */
        judge: judge
          ? { version: judge.version, busy: judge.busy, slots: judge.slots }
          : null,
        outOfDate: outOfDate(judge?.version ?? null),
      }
    }),
    /** Every judge reporting in, started here or not (a hand-set-up server too). */
    online: online.map((r) => ({
      host: r.host,
      slots: r.slots,
      busy: r.busy,
      pool: r.pool,
      version: r.version,
      fromDashboard: Boolean(r.machineId),
      outOfDate: outOfDate(r.version),
      /**
       * Which database login it judges as: its own limited one, the main one (which can read and
       * change everything), or not known yet (a judge older than migration 0082 says nothing).
       */
      login: (r.login === JUDGE_LOGIN
        ? "own"
        : r.login
          ? "main"
          : "unknown") as "own" | "main" | "unknown",
    })),
    /** The commit the site runs, which judges are compared with. */
    latest,
    settings: judgeSettingsOf(settings),
    /** Whether this copy can start machines at all. */
    available: machines() !== null,
    sizes: Object.entries(SETTINGS["judges.size"].choices).map(
      ([value, label]) => ({ value, label })
    ),
  }
}

/** Asks AWS for the row's machine; a refusal marks it failed, with AWS's reason in words. */
export async function launch(
  provider: Machines,
  row: Machine,
  pool: string | null
) {
  try {
    const instanceId = await provider.start({
      size: row.size,
      pool,
      rowId: row.id,
    })
    await getDb()
      .update(judgeMachines)
      .set({ instanceId, stage: "launching", note: "", stageAt: new Date() })
      .where(eq(judgeMachines.id, row.id))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await setStage(
      row.id,
      "failed",
      `AWS refused to start it: ${reason}`.slice(0, 1500)
    )
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
  await launch(provider, row, poolOrg?.slug ?? null)
  return machineOrNotFound(row.id)
}

/**
 * Stop: a machine still setting up is ended at once; a ready one drains first (finishes its
 * work, takes no more), and reconcileJudges ends it once it says it's drained.
 */
export async function stopJudge(user: User, id: string) {
  const row = await machineOrNotFound(id)
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
  await getDb()
    .update(judgeMachines)
    .set({ updateWanted: false })
    .where(eq(judgeMachines.id, row.id))
  await writePlatformAudit(user, "judges.stop", "Stopped a judge machine", {
    machine: row.id,
    instance: row.instanceId,
  })
  return machineOrNotFound(id)
}

/** Update: this machine is replaced by one with the latest code (see advanceUpdates). */
export async function updateJudge(user: User, id: string) {
  const provider = needMachines()
  const row = await machineOrNotFound(id)
  if (row.stage !== "ready") {
    throw new ApiError(
      409,
      "not_ready",
      "Only a ready machine can be updated: one still setting up already gets the latest code."
    )
  }
  await getDb()
    .update(judgeMachines)
    .set({ updateWanted: true, updateRequestedBy: user.id })
    .where(eq(judgeMachines.id, row.id))
  await writePlatformAudit(
    user,
    "judges.update",
    "Asked for a judge machine to be updated",
    { machine: row.id, instance: row.instanceId }
  )
  await advanceUpdates(provider)
  return machineOrNotFound(id)
}

/** Update all: every ready machine whose judge runs other code than the site. */
export async function updateAllJudges(user: User) {
  const provider = needMachines()
  const latest = latestVersion()
  if (!latest) {
    throw new ApiError(
      409,
      "version_unknown",
      "This copy doesn't know which code is current, so it can't tell which judges are out of date."
    )
  }
  const db = getDb()
  const behind = await db
    .select({ id: judgeMachines.id })
    .from(judgeMachines)
    .innerJoin(runners, eq(runners.machineId, judgeMachines.instanceId))
    .where(
      and(
        eq(judgeMachines.stage, "ready"),
        eq(judgeMachines.updateWanted, false),
        gt(runners.lastSeenAt, onlineSince()),
        isNotNull(runners.version),
        sql.ne(runners.version, latest)
      )
    )
  const ids = [...new Set(behind.map((row) => row.id))]
  if (ids.length) {
    await db
      .update(judgeMachines)
      .set({ updateWanted: true, updateRequestedBy: user.id })
      .where(inArray(judgeMachines.id, ids))
    await writePlatformAudit(
      user,
      "judges.update",
      `Asked for ${ids.length} judge machine(s) to be updated`,
      { machines: ids }
    )
    await advanceUpdates(provider)
  }
  return { updating: ids.length }
}

/**
 * Moves updates on, one machine at a time: a replacement that's ready lets its old machine
 * drain; a replacement that failed leaves the old one working (and says so); and with no
 * replacement coming up, the next machine waiting for an update gets one.
 */
async function advanceUpdates(provider: Machines) {
  const db = getDb()
  const replacements = await db
    .select()
    .from(judgeMachines)
    .where(isNotNull(judgeMachines.replacesId))
  const olds = replacements.length
    ? await db
        .select()
        .from(judgeMachines)
        .where(
          inArray(
            judgeMachines.id,
            replacements.map((r) => r.replacesId!)
          )
        )
    : []
  const oldOf = new Map(olds.map((o) => [o.id, o]))
  for (const fresh of replacements) {
    const old = oldOf.get(fresh.replacesId!)
    if (!old || !old.updateWanted) continue
    if (fresh.stage === "ready" && old.stage === "ready") {
      await db
        .update(judgeMachines)
        .set({
          stage: "draining",
          note: "Replaced by a judge with newer code: finishing its work, then it ends",
          updateWanted: false,
          stageAt: new Date(),
        })
        .where(eq(judgeMachines.id, old.id))
    } else if (fresh.stage === "failed" || fresh.stage === "stopped") {
      await db
        .update(judgeMachines)
        .set({
          updateWanted: false,
          note: "The update didn't work: its replacement failed (see it above). This machine keeps working.",
        })
        .where(eq(judgeMachines.id, old.id))
    }
  }
  // The next one, under the same lock as Start, so two tidy-ups at once can't both start one.
  const next = await db.transaction(async (tx) => {
    await tx.execute(
      sql.sql`select pg_advisory_xact_lock(hashtext('judge_machines'))`
    )
    const [coming] = await tx
      .select({ id: judgeMachines.id })
      .from(judgeMachines)
      .where(
        and(
          isNotNull(judgeMachines.replacesId),
          inArray(judgeMachines.stage, COMING_UP)
        )
      )
      .limit(1)
    if (coming) return null
    const waiting = await tx
      .select()
      .from(judgeMachines)
      .where(
        and(
          eq(judgeMachines.stage, "ready"),
          eq(judgeMachines.updateWanted, true)
        )
      )
      .orderBy(asc(judgeMachines.createdAt))
    const replaced = new Set(
      replacements
        .filter((r) => LIVE.includes(r.stage))
        .map((r) => r.replacesId)
    )
    const old = waiting.find((w) => !replaced.has(w.id))
    if (!old) return null
    const settings = await getSettings()
    const [created] = await tx
      .insert(judgeMachines)
      .values({
        poolOrgId: old.poolOrgId,
        size: settings["judges.size"],
        requestedBy: old.updateRequestedBy,
        replacesId: old.id,
      })
      .returning()
    return created!
  })
  if (!next) return
  const [org] = next.poolOrgId
    ? await db
        .select({ slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, next.poolOrgId))
    : []
  await launch(provider, next, org?.slug ?? null)
}

/**
 * Keeps every row true to AWS: a drained machine is ended, an ended one is stopped (or failed,
 * if nobody asked it to stop), one stuck setting up for half an hour has failed, and updates
 * move on. Cheap when nothing is live; never throws.
 */
export async function reconcileJudges() {
  const provider = machines()
  if (!provider) return { ended: 0, updated: 0 }
  const db = getDb()
  let ended = 0
  let updated = 0
  try {
    const stuck = await db
      .update(judgeMachines)
      .set({
        stage: "failed",
        note: "It didn't finish setting up within 30 minutes. Stop it to end the machine; the EC2 console's system log shows how far it got.",
        stageAt: new Date(),
      })
      .where(
        and(
          inArray(judgeMachines.stage, ["launching", "installing"]),
          lt(judgeMachines.stageAt, new Date(Date.now() - SETUP_LIMIT_MS))
        )
      )
      .returning({ id: judgeMachines.id })
    updated += stuck.length
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
    if (withIds.length) {
      const states = await provider.states(
        withIds.map((row) => row.instanceId!)
      )
      for (const row of withIds) {
        const state = states.get(row.instanceId!)
        const gone =
          !state || state === "terminated" || state === "shutting-down"
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
    }
    await advanceUpdates(provider)
  } catch (error) {
    console.error("[judges] reconcile:", error)
  }
  return { ended, updated }
}

/** The setup check: every piece a start needs, tried without starting anything. */
export async function checkJudges(): Promise<CheckResult[]> {
  const provider = machines()
  if (!provider) {
    return [
      {
        name: "The website's AWS role",
        ok: false,
        detail:
          "JUDGES_AWS_ROLE_ARN isn't set here, so this copy can't reach AWS. On the live site it's set in Vercel (Production), and only production deployments are trusted.",
      },
    ]
  }
  const settings = await getSettings()
  return provider.check(settings["judges.size"])
}

export const settingsSchema = z
  .object({
    maxRunning: SETTINGS["judges.max_running"].schema,
    size: SETTINGS["judges.size"].schema,
    autoscale: SETTINGS["judges.autoscale"].schema,
    minShared: SETTINGS["judges.min_shared"].schema,
    scaleUpSeconds: SETTINGS["judges.scale_up_seconds"].schema,
    idleMinutes: SETTINGS["judges.idle_minutes"].schema,
    studentsPerJudge: SETTINGS["judges.exam_students_per_judge"].schema,
    warmupMinutes: SETTINGS["judges.exam_warmup_minutes"].schema,
  })
  .partial()

/** The judge settings as the page edits them. */
const judgeSettingsOf = (
  settings: Awaited<ReturnType<typeof getSettings>>
) => ({
  maxRunning: settings["judges.max_running"],
  size: settings["judges.size"],
  autoscale: settings["judges.autoscale"],
  minShared: settings["judges.min_shared"],
  scaleUpSeconds: settings["judges.scale_up_seconds"],
  idleMinutes: settings["judges.idle_minutes"],
  studentsPerJudge: settings["judges.exam_students_per_judge"],
  warmupMinutes: settings["judges.exam_warmup_minutes"],
})

/** Each judge setting: its key, and its name in the activity log. */
const SETTING_FIELDS = {
  maxRunning: ["judges.max_running", "Judges at once"],
  size: ["judges.size", "Machine size"],
  autoscale: ["judges.autoscale", "Automatic scaling"],
  minShared: ["judges.min_shared", "Judges for everyone, at least"],
  scaleUpSeconds: [
    "judges.scale_up_seconds",
    "Start another after work waits (s)",
  ],
  idleMinutes: ["judges.idle_minutes", "End an idle judge after (min)"],
  studentsPerJudge: [
    "judges.exam_students_per_judge",
    "Students per judge for an exam",
  ],
  warmupMinutes: ["judges.exam_warmup_minutes", "Warm up before an exam (min)"],
} as const

/** Saves the judge settings given (any of them); only those change, and only those are logged. */
export async function saveJudgeSettings(
  user: User,
  input: z.infer<typeof settingsSchema>
) {
  const given = Object.entries(input).filter(([, v]) => v !== undefined) as [
    keyof typeof SETTING_FIELDS,
    unknown,
  ][]
  if (given.length === 0)
    throw new ApiError(400, "nothing_to_save", "No settings were given.")
  await updateSettings(
    Object.fromEntries(given.map(([k, v]) => [SETTING_FIELDS[k][0], v]))
  )
  await writePlatformAudit(user, "judges.settings", "Changed judge settings", {
    changes: given.map(([k, v]) => ({
      field: SETTING_FIELDS[k][1],
      to: typeof v === "boolean" ? (v ? "on" : "off") : v,
    })),
  })
  return judgeSettingsOf(await getSettings())
}
