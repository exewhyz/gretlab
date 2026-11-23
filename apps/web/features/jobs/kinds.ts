import { getDb, jobFiles, sql } from "@workspace/db"

import { gradebookCsvPart } from "@/features/assignments/gradebook-server"

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
  step: (tx: Tx, job: JobRow) => Promise<StepOut>
}

/** Rows a step handles. */
export const STEP = 1_000

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
      const part = await gradebookCsvPart(
        input.assignmentId,
        job.orgId,
        input.scope === "all" ? "all" : new Set(input.scope),
        offset,
        STEP
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
} satisfies Record<string, JobKind>
