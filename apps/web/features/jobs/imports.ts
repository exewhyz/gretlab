import { getDb, jobRows, jobs, sql, type User } from "@workspace/db"
import { z } from "zod"

import { ApiError, notFound } from "@/lib/api/route"
import { seal, unseal } from "@/lib/sealed"

import { kickJobs } from "./server"

/*
 * Imports bigger than one request can carry (Vercel refuses bodies over about 4.5 MB): the
 * browser still reads the file, then uploads its rows in parts of IMPORT_PART_ROWS, sealed in
 * job_rows; a job checks the whole file and reports (as the instant import does), then, when
 * asked, commits the same rows. Checking and writing stay one step over the whole file, so an
 * import keeps its all-at-once rules (duplicates within the file, handles, one transaction).
 */

const { and, eq, sql: q } = sql

export const IMPORT_MAX_ROWS = 50_000
export const IMPORT_PART_ROWS = 5_000
const SEAL = "job-rows"

export const IMPORT_KINDS = ["members.import", "students.import"] as const
export type ImportKind = (typeof IMPORT_KINDS)[number]

export const startImportSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  slug: z.string().min(1).max(100),
  total: z.number().int().min(1).max(IMPORT_MAX_ROWS),
  /** The members import's "create missing groups". */
  createGroups: z.boolean().default(false),
})

export const partSchema = z.object({
  seq: z
    .number()
    .int()
    .min(0)
    .max(IMPORT_MAX_ROWS / IMPORT_PART_ROWS),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(IMPORT_PART_ROWS),
})

/** Who may import, checked before any row is accepted (and again when it runs). */
async function mayImport(kind: ImportKind, slug: string, user: User) {
  if (kind === "members.import") {
    const { importAllowed } = await import("@/features/orgs/server")
    return importAllowed(slug, user)
  }
  const { studentImportAllowed } =
    await import("@/features/records/students-server")
  return studentImportAllowed(slug, user)
}

export async function startImport(
  user: User,
  input: z.infer<typeof startImportSchema>
) {
  const orgId = await mayImport(input.kind, input.slug, user)
  const [row] = await getDb()
    .insert(jobs)
    .values({
      kind: input.kind,
      orgId,
      createdBy: user.id,
      status: "uploading",
      input: {
        slug: input.slug,
        total: input.total,
        createGroups: input.createGroups,
        commit: false,
      },
    })
    .returning({ id: jobs.id })
  return { job: row!.id, partRows: IMPORT_PART_ROWS }
}

async function ownImport(user: User, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Import not found")
  const [job] = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.createdBy, user.id)))
  if (!job || !(IMPORT_KINDS as readonly string[]).includes(job.kind))
    throw notFound("Import not found")
  return job
}

/** One part of the file. Sending the same part again replaces it, so a retry is safe. */
export async function addPart(
  user: User,
  id: string,
  part: z.infer<typeof partSchema>
) {
  const job = await ownImport(user, id)
  if (job.status !== "uploading")
    throw new ApiError(409, "not_uploading", "This import has started already.")
  const total = Number(job.input.total)
  const db = getDb()
  await db
    .insert(jobRows)
    .values({
      jobId: job.id,
      seq: part.seq,
      count: part.rows.length,
      data: seal(SEAL, JSON.stringify(part.rows)),
    })
    .onConflictDoUpdate({
      target: [jobRows.jobId, jobRows.seq],
      set: {
        count: part.rows.length,
        data: seal(SEAL, JSON.stringify(part.rows)),
      },
    })
  const [{ n } = { n: 0 }] = (await db.execute(
    q`select coalesce(sum(count), 0)::int as n from job_rows where job_id = ${job.id}`
  )) as unknown as { n: number }[]
  if (n > total) {
    await db
      .delete(jobRows)
      .where(and(eq(jobRows.jobId, job.id), eq(jobRows.seq, part.seq)))
    throw new ApiError(
      400,
      "too_many_rows",
      `That's more rows than the ${total} this import said it has.`
    )
  }
  return { received: n, total }
}

/**
 * Checks the whole file (commit: false), or adds it (commit: true, after a check). Either way a
 * job does it; GET /jobs/:id follows it.
 */
export async function runImport(user: User, id: string, commit: boolean) {
  const job = await ownImport(user, id)
  const checked = job.status === "done" && job.input.commit === false
  if (job.status === "uploading") {
    const [{ n } = { n: 0 }] = (await getDb().execute(
      q`select coalesce(sum(count), 0)::int as n from job_rows where job_id = ${job.id}`
    )) as unknown as { n: number }[]
    if (n !== Number(job.input.total))
      throw new ApiError(
        409,
        "not_uploaded",
        `${n} of ${job.input.total} rows have arrived; send the rest first.`
      )
    if (commit)
      throw new ApiError(409, "not_checked", "Check the file before adding it.")
  } else if (!(checked && commit)) {
    throw new ApiError(409, "already_run", "This import has run already.")
  }
  await getDb()
    .update(jobs)
    .set({
      status: "queued",
      input: { ...job.input, commit },
      cursor: null,
      progress: 0,
      result: null,
      attempts: 0,
      lastError: null,
      nextAttemptAt: new Date(),
      finishedAt: null,
    })
    .where(eq(jobs.id, job.id))
  await getDb().execute(q`select pg_notify('gretlab_jobs', '')`)
  kickJobs()
  return { job: job.id }
}

/** The file's rows, in order: for the job that checks or adds them. */
export async function rowsOf(jobId: string) {
  const parts = await getDb()
    .select({ data: jobRows.data })
    .from(jobRows)
    .where(eq(jobRows.jobId, jobId))
    .orderBy(jobRows.seq)
  return parts.flatMap(
    (p) => JSON.parse(unseal(SEAL, p.data) ?? "[]") as Record<string, unknown>[]
  )
}
