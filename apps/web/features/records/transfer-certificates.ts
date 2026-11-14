import {
  getDb,
  sql,
  transferCertificates,
  users,
  type User,
} from "@workspace/db"
import { nextSerial } from "@workspace/judge"
import { z } from "zod"

import { today } from "@/features/catalog/server"
import { orgContext, writeAudit } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { seal, unseal } from "@/lib/sealed"
import { day, forbidden, needModule } from "./records-core"
import { getStudent, setStatus } from "./students-server"

/*
 * Student records (a module): academic years, each student's record (admission number,
 * gender, and phone, date of birth and address sealed), and an enrolment per student per
 * year placing them in a group with a roll number and a status. The current year's
 * active enrolments are the students' places (group_members), so registers, timetables,
 * parents and the rest follow them: making another year current, or placing, moving or
 * withdrawing a student, rewrites their places (place / syncPlaces). A student may never
 * sign in: their account then has an address on .invalid (noLoginEmail), which Google
 * can't sign in and the outbox never mails. Rules in packages/judge/src/records.ts.
 */

const { and, desc, eq, ilike } = sql

export const tcSchema = z.object({
  leavingDate: day,
  reason: z.string().trim().max(200).default(""),
  conduct: z.string().trim().max(100).default("Good"),
  remarks: z.string().trim().max(500).default(""),
  /** Also mark them transferred in their current class. */
  markTransferred: z.boolean().default(true),
})

/** What a certificate says, kept as issued (sealed). */
export interface TcDetails {
  name: string
  admissionNo: string
  gender: string
  birthDate: string
  admittedOn: string
  parents: { name: string; relation: string }[]
  lastClass: string | null
  lastYear: string | null
  rollNo: number | null
}

export const TC_SEAL = "transfer certificate"

/** Issues a certificate (and, by default, marks the student transferred). */
export async function issueTransferCertificate(
  slug: string,
  user: User,
  studentId: string,
  input: z.infer<typeof tcSchema>
) {
  const student = await getStudent(slug, user, studentId)
  if (!student.can.edit)
    throw forbidden(
      'Issuing a transfer certificate needs "Add and edit students" for their class.'
    )
  const ctx = await orgContext(slug, user)
  if (input.leavingDate < student.admittedOn)
    throw new ApiError(
      400,
      "bad_date",
      "They can't leave before they were admitted."
    )
  const issuedOn = await today()
  if (input.leavingDate > issuedOn)
    throw new ApiError(
      400,
      "bad_date",
      "The leaving date can't be after today."
    )
  const last = student.history[0] ?? null
  const details: TcDetails = {
    name: student.name,
    admissionNo: student.admissionNo,
    gender: student.gender,
    birthDate: student.birthDate,
    admittedOn: student.admittedOn,
    parents: student.parents.map((p) => ({
      name: p.name,
      relation: p.relation,
    })),
    lastClass: last?.group ?? null,
    lastYear: last?.year ?? null,
    rollNo: last?.rollNo ?? null,
  }
  const row = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql.sql`select 1 from organizations where id = ${ctx.org.id} for update`
    )
    const prefix = `TC-${issuedOn.slice(0, 4)}-`
    const used = await tx
      .select({ n: transferCertificates.number })
      .from(transferCertificates)
      .where(
        and(
          eq(transferCertificates.orgId, ctx.org.id),
          ilike(transferCertificates.number, `${prefix}%`)
        )
      )
    const [created] = await tx
      .insert(transferCertificates)
      .values({
        orgId: ctx.org.id,
        userId: studentId,
        number: nextSerial(
          prefix,
          used.map((u) => u.n)
        ),
        issuedOn,
        leavingDate: input.leavingDate,
        reason: input.reason,
        conduct: input.conduct,
        remarks: input.remarks,
        details: seal(TC_SEAL, JSON.stringify(details)),
        issuedBy: user.id,
      })
      .returning()
    return created!
  })
  await writeAudit(
    ctx,
    "records.tc",
    `Issued transfer certificate ${row.number} to ${student.name} (${student.admissionNo})`,
    { studentId, number: row.number }
  )
  if (input.markTransferred && student.current?.status === "active")
    await setStatus(slug, user, studentId, "transferred")
  return { id: row.id, number: row.number }
}

/** A student's certificates, newest first. */
export async function transferCertificatesOf(
  slug: string,
  user: User,
  studentId: string
) {
  await getStudent(slug, user, studentId)
  const ctx = await orgContext(slug, user)
  const rows = await getDb()
    .select({
      id: transferCertificates.id,
      number: transferCertificates.number,
      issuedOn: transferCertificates.issuedOn,
      leavingDate: transferCertificates.leavingDate,
    })
    .from(transferCertificates)
    .where(
      and(
        eq(transferCertificates.orgId, ctx.org.id),
        eq(transferCertificates.userId, studentId)
      )
    )
    .orderBy(desc(transferCertificates.createdAt))
  return { certificates: rows }
}

/** One certificate, as issued, for printing. Those who may see the student only. */
export async function transferCertificate(
  slug: string,
  user: User,
  id: string
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!z.uuid().safeParse(id).success) throw notFound("Certificate not found")
  const [row] = await getDb()
    .select()
    .from(transferCertificates)
    .where(
      and(
        eq(transferCertificates.id, id),
        eq(transferCertificates.orgId, ctx.org.id)
      )
    )
  if (!row) throw notFound("Certificate not found")
  // The same check as opening the student's record.
  await getStudent(slug, user, row.userId).catch(() => {
    throw notFound("Certificate not found")
  })
  const [issuer] = row.issuedBy
    ? await getDb()
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, row.issuedBy))
    : []
  await writeAudit(
    ctx,
    "records.tc_print",
    `Printed transfer certificate ${row.number}`,
    { id }
  )
  return {
    org: { name: ctx.org.name },
    number: row.number,
    issuedOn: row.issuedOn,
    leavingDate: row.leavingDate,
    reason: row.reason,
    conduct: row.conduct,
    remarks: row.remarks,
    issuedBy: issuer ? (issuer.name ?? issuer.email) : null,
    details: JSON.parse(unseal(TC_SEAL, row.details) ?? "{}") as TcDetails,
  }
}
