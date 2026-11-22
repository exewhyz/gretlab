import { assignments, getDb, judgeMachines, runners, sql } from "@workspace/db"
import { RUNNER_ONLINE_MS, scaleDecision, sharedWanted } from "@workspace/judge"

import { studentsOf } from "@/features/assignments/server"
import { writeSystemEntry } from "@/features/audit/server"
import { getSettings } from "@/features/settings/server"

import { machines } from "./machines"
import { COMING_UP, LIVE, launch, setStage } from "./server"

/*
 * Automatic scaling of the shared judges (packages/judge/src/autoscale.ts decides; this gathers
 * the numbers and does it). Run by the Judges page, the email cron and, a few seconds apart at
 * most, new submissions, so work waiting is noticed within moments. Off unless switched on.
 * Every start and stop goes in the platform's activity log as "GretLab (automatic scaling)".
 */

const { and, count, eq, gt, inArray, isNull, lte, gte } = sql
const LABEL = "GretLab (automatic scaling)"
/** Per server: at most one look every this often (each is a handful of small queries). */
const EVERY_MS = 10_000
let lastRun = 0

export async function autoscaleJudges(opts: { force?: boolean } = {}) {
  const provider = machines()
  if (!provider) return { action: "none" as const }
  if (!opts.force && Date.now() - lastRun < EVERY_MS)
    return { action: "none" as const }
  lastRun = Date.now()
  const settings = await getSettings()
  if (!settings["judges.autoscale"]) return { action: "none" as const }
  const db = getDb()
  const online = new Date(Date.now() - RUNNER_ONLINE_MS)
  try {
    const [[live], sharedOnline, [coming], [waiting], idle, exams] =
      await Promise.all([
        db
          .select({ n: count() })
          .from(judgeMachines)
          .where(inArray(judgeMachines.stage, LIVE)),
        db
          .select({ machineId: runners.machineId })
          .from(runners)
          .where(
            and(isNull(runners.poolOrgId), gt(runners.lastSeenAt, online))
          ),
        db
          .select({ n: count() })
          .from(judgeMachines)
          .where(
            and(
              isNull(judgeMachines.poolOrgId),
              inArray(judgeMachines.stage, COMING_UP)
            )
          ),
        // Shared work: the shared pool's, and any organization's whose own judges are all down
        // (the same rule as the judges' claimNext).
        db.execute(sql.sql`
          select coalesce(extract(epoch from now() - min(s.created_at)), 0) as seconds
          from submissions s
          where s.status = 'queued'
            and (s.pool_org_id is null or not exists (
              select 1 from runners r
              where r.pool_org_id = s.pool_org_id
                and r.last_seen_at > now() - make_interval(secs => ${RUNNER_ONLINE_MS / 1000})))`) as unknown as Promise<
          { seconds: number | string }[]
        >,
        db
          .select({
            id: judgeMachines.id,
            // By the database's clock, like the stamp itself.
            idleSeconds:
              sql.sql<number>`extract(epoch from now() - ${runners.lastBusyAt})`.mapWith(
                Number
              ),
            busy: runners.busy,
          })
          .from(judgeMachines)
          .innerJoin(runners, eq(runners.machineId, judgeMachines.instanceId))
          .where(
            and(
              eq(judgeMachines.auto, true),
              isNull(judgeMachines.poolOrgId),
              eq(judgeMachines.stage, "ready"),
              gt(runners.lastSeenAt, online)
            )
          ),
        // Exams opening within the warm-up time, whose work will be shared (their
        // organization has no judge of its own online).
        db
          .select()
          .from(assignments)
          .where(
            and(
              eq(assignments.published, true),
              sql.isNotNull(assignments.exam),
              gte(assignments.opensAt, new Date()),
              lte(
                assignments.opensAt,
                new Date(
                  Date.now() + settings["judges.exam_warmup_minutes"] * 60_000
                )
              ),
              sql.sql`(${assignments.orgId} is null or not exists (
                select 1 from runners r where r.pool_org_id = ${assignments.orgId}
                  and r.last_seen_at > now() - make_interval(secs => ${RUNNER_ONLINE_MS / 1000})))`
            )
          ),
      ])
    let examStudents = 0
    for (const exam of exams)
      examStudents += (await studentsOf(exam, "all")).length
    const decision = scaleDecision({
      on: true,
      minShared: settings["judges.min_shared"],
      scaleUpSeconds: settings["judges.scale_up_seconds"],
      idleMinutes: settings["judges.idle_minutes"],
      studentsPerJudge: settings["judges.exam_students_per_judge"],
      maxRunning: settings["judges.max_running"],
      liveMachines: live?.n ?? 0,
      onlineShared: sharedOnline.length,
      comingShared: coming?.n ?? 0,
      oldestSharedWaitSeconds: Number(waiting?.seconds ?? 0),
      examStudents,
      idle: idle
        .filter((j) => j.busy === 0)
        .map((j) => ({
          id: j.id,
          idleMinutes: j.idleSeconds / 60,
        })),
    })
    if (decision.action === "start") {
      // Checked again under Start's lock: someone pressing Start meanwhile can't push past
      // the limit, and two servers deciding at once start one machine.
      const row = await db.transaction(async (tx) => {
        await tx.execute(
          sql.sql`select pg_advisory_xact_lock(hashtext('judge_machines'))`
        )
        const [[now], [up]] = await Promise.all([
          tx
            .select({ n: count() })
            .from(judgeMachines)
            .where(inArray(judgeMachines.stage, LIVE)),
          tx
            .select({ n: count() })
            .from(judgeMachines)
            .where(
              and(
                isNull(judgeMachines.poolOrgId),
                inArray(judgeMachines.stage, COMING_UP)
              )
            ),
        ])
        if ((now?.n ?? 0) >= settings["judges.max_running"] || (up?.n ?? 0) > 0)
          return null
        const [created] = await tx
          .insert(judgeMachines)
          .values({
            size: settings["judges.size"],
            auto: true,
            note: decision.reason,
          })
          .returning()
        return created!
      })
      if (!row) return { action: "none" as const }
      await writeSystemEntry(
        LABEL,
        "judges.autoscale",
        `Started a judge: ${decision.reason}`,
        {
          machine: row.id,
          wanted: sharedWanted({
            minShared: settings["judges.min_shared"],
            examStudents,
            studentsPerJudge: settings["judges.exam_students_per_judge"],
          }),
        }
      )
      await launch(provider, row, null)
    } else if (decision.action === "drain") {
      await setStage(decision.id, "draining", decision.reason)
      await writeSystemEntry(
        LABEL,
        "judges.autoscale",
        `Stopped a judge: ${decision.reason}`,
        {
          machine: decision.id,
        }
      )
    }
    return decision
  } catch (error) {
    console.error("[judges] autoscale:", error)
    return { action: "none" as const }
  }
}
