import { getDb, jobFiles, jobRows, sql, users } from "@workspace/db"

/*
 * What each kind of job does, one step at a time (features/jobs/server.ts runs them). A step
 * works on about STEP rows, writes them in the transaction it's given, and says where the next
 * step starts. Steps must be safe to run again: a step that fails or is cut off is rolled back
 * whole, and the job carries on from the last saved cursor.
 */

type Db = ReturnType<typeof getDb>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export interface JobRow {
  id: string
  kind: string
  orgId: string | null
  createdBy: string | null
  input: Record<string, unknown>
  cursor: unknown
  progress: number
  total: number | null
  attempts: number
}

export interface StepOut {
  cursor: unknown
  progress: number
  total?: number | null
  done: boolean
  result?: { summary: string; lines?: string[] }
}

export interface JobKind {
  /** What people read while it runs ("Gradebook export"). */
  label: string
  /**
   * How long one step may hold the job, when longer than the usual minute: an import checks and
   * writes a whole file in one step. Nobody else takes the job while a step holds it.
   */
  leaseMs?: number
  step: (tx: Tx, job: JobRow) => Promise<StepOut>
}

/** Rows a step writes. */
export const STEP = 1_000
/**
 * Rows an export step reads: more, since an export only reads and each step's fixed cost
 * (finding the class, the assignment) is most of the time; still seconds, well inside a lease.
 */
export const EXPORT_STEP = 5_000

/** A file's first part, or more of it. */
export async function writeFile(
  tx: Tx,
  jobId: string,
  part: { name: string; contentType: string; text: string },
  first: boolean
) {
  const bytes = Buffer.from(part.text, "utf8")
  if (first) {
    await tx
      .insert(jobFiles)
      .values({
        jobId,
        name: part.name,
        contentType: part.contentType,
        data: bytes,
      })
      .onConflictDoUpdate({
        target: jobFiles.jobId,
        set: {
          name: part.name,
          contentType: part.contentType,
          data: bytes,
          createdAt: new Date(),
        },
      })
  } else {
    await tx.execute(
      sql.sql`update job_files set data = data || ${bytes} where job_id = ${jobId}`
    )
  }
}

export const KINDS = {
  /** An assignment's gradebook as CSV, the same file as the instant download, for any size. */
  "gradebook.csv": {
    label: "Gradebook export",
    async step(tx, job) {
      const input = job.input as {
        assignmentId: string
        scope: "all" | string[]
      }
      const offset = (job.cursor as { offset?: number } | null)?.offset ?? 0
      // Loaded when it runs: feature modules start jobs, so importing them here would loop.
      const { gradebookCsvPart } =
        await import("@/features/assignments/gradebook-server")
      const part = await gradebookCsvPart(
        input.assignmentId,
        job.orgId,
        input.scope === "all" ? "all" : new Set(input.scope),
        offset,
        EXPORT_STEP
      )
      await writeFile(
        tx,
        job.id,
        {
          name: part.filename,
          contentType: "text/csv; charset=utf-8",
          text: part.text,
        },
        offset === 0
      )
      const done = part.next >= part.total
      return {
        cursor: { offset: part.next },
        progress: part.next,
        total: part.total,
        done,
        result: done
          ? {
              summary: `${part.total} ${part.total === 1 ? "student" : "students"} exported.`,
            }
          : undefined,
      }
    },
  },
  /**
   * Reports' student table as CSV, every student, in the on-screen table's order. Each step is
   * checked as the person who started it, so taking away their access stops the export.
   */
  "reports.csv": {
    label: "Reports export",
    async step(tx, job) {
      const input = job.input as { slug: string; groupId: string | null }
      const page = (job.cursor as { page?: number } | null)?.page ?? 1
      const { orgReportCsvPart } = await import("@/features/teaching/server")
      const part = await orgReportCsvPart(
        input.slug,
        await starter(job),
        input.groupId,
        page,
        EXPORT_STEP
      )
      await writeFile(
        tx,
        job.id,
        {
          name: `${input.slug}-students.csv`,
          contentType: "text/csv; charset=utf-8",
          text: part.text,
        },
        page === 1
      )
      return {
        cursor: { page: page + 1 },
        progress: part.exported,
        total: part.total,
        done: part.done,
        result: part.done
          ? {
              summary: `${part.total} ${part.total === 1 ? "student" : "students"} exported.`,
            }
          : undefined,
      }
    },
  },
  "members.import": importKind("members.import", "Members import"),
  "students.import": importKind("students.import", "Students import"),
} satisfies Record<string, JobKind>

/** A report as CSV, defused against spreadsheet formulas (as every export here is). */
function reportCsv(
  lines: { line: number; who: string; result: string; note: string }[]
) {
  const field = (value: string | number) => {
    let text = String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return (
    "\ufeff" +
    [
      ["Line", "Who", "Result", "Note"],
      ...lines.map((l) => [l.line, l.who, l.result, l.note]),
    ]
      .map((r) => r.map(field).join(","))
      .join("\r\n") +
    "\r\n"
  )
}

/**
 * An import (features/jobs/imports): the whole file in one step, as the instant import does it,
 * as the person who started it. Checking reports what would happen; adding writes it and drops
 * the uploaded rows. The full report becomes the job's file; the problems (500 at most) and the
 * figures go in its result.
 */
function importKind(
  kind: "members.import" | "students.import",
  label: string
): JobKind {
  return {
    label,
    leaseMs: 10 * 60_000,
    async step(tx, job) {
      const input = job.input as {
        slug: string
        createGroups?: boolean
        commit: boolean
      }
      const { rowsOf } = await import("./imports")
      const rows = await rowsOf(job.id)
      const user = await starter(job)
      let lines: { line: number; who: string; result: string; note: string }[]
      let data: Record<string, unknown>
      if (kind === "members.import") {
        const { importMembers } = await import("@/features/orgs/server")
        const { importJobSchema } = await import("@/features/orgs/schemas")
        const out = await importMembers(
          input.slug,
          user,
          importJobSchema.parse({
            rows,
            createGroups: input.createGroups,
            commit: input.commit,
          })
        )
        lines = out.rows.map((r) => ({
          line: r.line,
          who: r.email,
          result: r.action,
          note: r.note,
        }))
        data = { committed: out.committed, counts: out.counts }
      } else {
        const { importStudents, importJobSchema } =
          await import("@/features/records/students-server")
        const out = await importStudents(
          input.slug,
          user,
          importJobSchema.parse({ rows, commit: input.commit })
        )
        lines = out.rows.map((r) => ({
          line: r.line,
          who: r.name,
          result: r.result,
          note: r.note,
        }))
        data = { committed: out.committed, summary: out.summary }
      }
      const problems = lines.filter((l) => l.result === "error")
      await writeFile(
        tx,
        job.id,
        {
          name: `${input.slug}-${kind === "members.import" ? "members" : "students"}-import-report.csv`,
          contentType: "text/csv; charset=utf-8",
          text: reportCsv(lines),
        },
        true
      )
      if (input.commit)
        await tx.delete(jobRows).where(sql.eq(jobRows.jobId, job.id))
      const ok = lines.length - problems.length
      return {
        cursor: null,
        progress: lines.length,
        total: lines.length,
        done: true,
        result: {
          summary: input.commit
            ? `Added ${ok} of ${lines.length} rows${problems.length ? `; ${problems.length} had problems and were left out` : ""}.`
            : `${ok} of ${lines.length} rows can be added${problems.length ? `; ${problems.length} have problems` : ""}.`,
          lines: problems
            .slice(0, 500)
            .map((l) => `Line ${l.line}: ${l.who || "(blank)"}: ${l.note}`),
          data,
        },
      }
    },
  }
}

/** The person who started a job, to check each step as them. */
async function starter(job: JobRow) {
  const [user] = job.createdBy
    ? await getDb().select().from(users).where(sql.eq(users.id, job.createdBy))
    : []
  if (!user || user.disabled)
    throw new Error("The person who started this job can't any more")
  return user
}
