import { randomUUID } from "node:crypto"

import {
  academicYears,
  attendance,
  enrolments,
  getDb,
  groupMembers,
  guardians,
  orgMembers,
  roleAssignments as roleAssignmentsUser,
  orgRoles as roleOf,
  sql,
  studentRecords,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import {
  admissionPrefix,
  changesBetween,
  ENROLMENT_STATUSES,
  isNoLoginEmail,
  KINDS,
  nextAdmissionNo,
  noLoginEmail,
} from "@workspace/judge"
import { z } from "zod"

import { anyGroupGrant, pathName } from "@/features/campus/people"
import { campusOf } from "@/features/campus/server"
import { today } from "@/features/catalog/server"
import { rolePermissions } from "@/features/orgs/access"
import {
  canFor,
  orgContext,
  userByEmail,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { unseal } from "@/lib/sealed"
import {
  asDay,
  coversGroup,
  currentYear,
  forbidden,
  GENDERS,
  groupByPath,
  isLeaf,
  needModule,
  needPlace,
  pathIds,
  place,
  recordOf,
  SEAL,
  sealed,
  studentSchema,
  Tx,
} from "./records-core"

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

const { and, asc, desc, eq, ilike, inArray, or } = sql

export const PAGE = 50

/** Manage › Students: the records this person may see, filtered, a page at a time. */
export async function listStudents(
  slug: string,
  user: User,
  filters: { q?: string; groupId?: string; status?: string; page?: number }
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const can = {
    view: anyGroupGrant(ctx, "students.view"),
    edit: anyGroupGrant(ctx, "students.edit"),
    years: canFor(ctx, "students.years", []),
  }
  if (!can.view && !can.edit)
    throw forbidden("Student records aren't part of your role.")
  const db = getDb()
  const year = await currentYear(db, ctx.org.id)
  const term = filters.q?.trim()
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      admissionNo: studentRecords.admissionNo,
      gender: studentRecords.gender,
      groupId: enrolments.groupId,
      rollNo: enrolments.rollNo,
      status: enrolments.status,
    })
    .from(studentRecords)
    .innerJoin(users, eq(studentRecords.userId, users.id))
    .leftJoin(
      enrolments,
      and(
        eq(enrolments.userId, studentRecords.userId),
        eq(
          enrolments.yearId,
          year?.id ?? "00000000-0000-0000-0000-000000000000"
        )
      )
    )
    .where(
      and(
        eq(studentRecords.orgId, ctx.org.id),
        term
          ? or(
              ilike(users.name, `%${term}%`),
              ilike(users.email, `%${term}%`),
              ilike(studentRecords.admissionNo, `%${term}%`)
            )
          : undefined
      )
    )
    .orderBy(asc(studentRecords.admissionNo))
  const inside = filters.groupId
    ? new Set(
        ctx.groups
          .filter((g) => pathIds(ctx, g.id).includes(filters.groupId!))
          .map((g) => g.id)
      )
    : null
  const visible = rows.filter(
    (r) =>
      (coversGroup(ctx, "students.view", r.groupId) ||
        coversGroup(ctx, "students.edit", r.groupId)) &&
      (!inside || (r.groupId && inside.has(r.groupId))) &&
      (!filters.status ||
        (filters.status === "unplaced"
          ? !r.groupId || r.status !== "active"
          : (r.status ?? "") === filters.status))
  )
  const page = Math.max(1, filters.page ?? 1)
  return {
    terms: KINDS[ctx.org.type].terms,
    can,
    year: year ? { id: year.id, name: year.name } : null,
    total: visible.length,
    page,
    pages: Math.max(1, Math.ceil(visible.length / PAGE)),
    students: visible.slice((page - 1) * PAGE, page * PAGE).map((r) => ({
      id: r.id,
      name: r.name ?? r.email,
      admissionNo: r.admissionNo,
      gender: r.gender,
      login: !isNoLoginEmail(r.email),
      group: r.groupId
        ? { id: r.groupId, path: pathName(ctx, r.groupId) }
        : null,
      rollNo: r.rollNo,
      status: r.status ?? null,
    })),
    groups: ctx.groups.map((g) => ({
      id: g.id,
      name: g.name,
      parentId: g.parentId,
    })),
    levels: ctx.org.groupLevels,
    choosable: ctx.groups
      .filter(
        (g) => isLeaf(ctx, g.id) && canFor(ctx, "students.edit", [[g.id]])
      )
      .map((g) => g.id),
  }
}

export async function suggestAdmissionNo(ctx: OrgContext) {
  const year = await currentYear(getDb(), ctx.org.id)
  const startYear = Number((year?.startsOn ?? (await today())).slice(0, 4))
  const prefix = admissionPrefix(ctx.org.name, startYear)
  const used = await getDb()
    .select({ no: studentRecords.admissionNo })
    .from(studentRecords)
    .where(
      and(
        eq(studentRecords.orgId, ctx.org.id),
        ilike(studentRecords.admissionNo, `${prefix}%`)
      )
    )
  return nextAdmissionNo(
    prefix,
    used.map((u) => u.no)
  )
}

/** The next free admission number, for the Add student form. */
export async function nextNumber(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!anyGroupGrant(ctx, "students.edit"))
    throw forbidden("Adding students isn't part of your role.")
  return { admissionNo: await suggestAdmissionNo(ctx) }
}

export async function admissionFree(
  ctx: OrgContext,
  no: string,
  except?: string
) {
  const [clash] = await getDb()
    .select({ userId: studentRecords.userId })
    .from(studentRecords)
    .where(
      and(
        eq(studentRecords.orgId, ctx.org.id),
        eq(studentRecords.admissionNo, no)
      )
    )
  if (clash && clash.userId !== except)
    throw new ApiError(
      409,
      "duplicate",
      `Admission number ${no} is already used.`
    )
}

/**
 * Creates one student inside a transaction: their account (found by email, or a no-login
 * one), membership, record and, with a group and a current year, enrolment and place.
 */
/**
 * Creates a student (and their account, if new) with a record, and enrols them in a year's
 * section. Their place now (group_members) changes only for the current year. Shared with
 * Admissions (features/admissions), which admits into next year as well.
 */
export async function createInTx(
  tx: Tx,
  ctx: OrgContext,
  input: z.infer<typeof studentSchema>,
  admissionNo: string,
  year: typeof academicYears.$inferSelect | null
) {
  const email = input.email
    ? input.email.toLowerCase()
    : noLoginEmail(randomUUID())
  const person = await userByEmail(tx, email)
  const [already] = await tx
    .select({ id: studentRecords.userId })
    .from(studentRecords)
    .where(
      and(
        eq(studentRecords.orgId, ctx.org.id),
        eq(studentRecords.userId, person.id)
      )
    )
  if (already)
    throw new ApiError(
      409,
      "already_a_student",
      `${email} already has a student record here.`
    )
  if (!person.name || !input.email)
    await tx
      .update(users)
      .set({ name: input.name })
      .where(eq(users.id, person.id))
  await tx
    .insert(orgMembers)
    .values({
      orgId: ctx.org.id,
      userId: person.id,
      status: "active",
      joinedVia: "created",
    })
    .onConflictDoUpdate({
      target: [orgMembers.orgId, orgMembers.userId],
      set: { status: "active" },
    })
  await tx.insert(studentRecords).values({
    orgId: ctx.org.id,
    userId: person.id,
    admissionNo,
    gender: input.gender,
    birthDate: sealed(input.birthDate),
    phone: sealed(input.phone),
    address: sealed(input.address),
    admittedOn: await today(),
  })
  if (input.groupId && year) {
    await tx.insert(enrolments).values({
      orgId: ctx.org.id,
      yearId: year.id,
      userId: person.id,
      groupId: input.groupId,
      rollNo: input.rollNo,
    })
    if (year.isCurrent) await place(tx, ctx, person.id, input.groupId)
  }
  return person.id
}

export async function addStudent(
  slug: string,
  user: User,
  input: z.infer<typeof studentSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needPlace(ctx, input.groupId)
  const db = getDb()
  const year = await currentYear(db, ctx.org.id)
  if (input.groupId && !year)
    throw new ApiError(
      400,
      "no_year",
      "Add the current academic year before placing students."
    )
  const admissionNo = input.admissionNo || (await suggestAdmissionNo(ctx))
  await admissionFree(ctx, admissionNo)
  const id = await db.transaction((tx) =>
    createInTx(tx, ctx, input, admissionNo, year)
  )
  await writeAudit(
    ctx,
    "records.student_add",
    `Added ${input.name} (${admissionNo})${input.groupId ? ` to ${pathName(ctx, input.groupId)}` : ""}`,
    { login: Boolean(input.email) }
  )
  return { id, admissionNo }
}

export async function updateStudent(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof studentSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const { record, user: person, year, enrolment } = await recordOf(ctx, id)
  const from =
    enrolment?.status === "active" ? (enrolment.groupId ?? null) : null
  needPlace(ctx, from)
  if (input.groupId !== from) needPlace(ctx, input.groupId)
  if (input.groupId && !year)
    throw new ApiError(
      400,
      "no_year",
      "Add the current academic year before placing students."
    )
  const admissionNo = input.admissionNo || record.admissionNo
  await admissionFree(ctx, admissionNo, id)
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.update(users).set({ name: input.name }).where(eq(users.id, id))
    // A student who didn't sign in may be given an address to sign in with.
    if (input.email && isNoLoginEmail(person.email)) {
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email.toLowerCase()))
      if (taken)
        throw new ApiError(
          409,
          "email_taken",
          `${input.email} already has an account.`
        )
      await tx
        .update(users)
        .set({ email: input.email.toLowerCase() })
        .where(eq(users.id, id))
    }
    await tx
      .update(studentRecords)
      .set({
        admissionNo,
        gender: input.gender,
        birthDate: sealed(input.birthDate),
        phone: sealed(input.phone),
        address: sealed(input.address),
      })
      .where(
        and(eq(studentRecords.orgId, ctx.org.id), eq(studentRecords.userId, id))
      )
    if (year) {
      if (input.groupId) {
        await tx
          .insert(enrolments)
          .values({
            orgId: ctx.org.id,
            yearId: year.id,
            userId: id,
            groupId: input.groupId,
            rollNo: input.rollNo,
          })
          .onConflictDoUpdate({
            target: [enrolments.yearId, enrolments.userId],
            set: {
              groupId: input.groupId,
              rollNo: input.rollNo,
              status: "active",
            },
          })
      } else if (enrolment) {
        await tx.delete(enrolments).where(eq(enrolments.id, enrolment.id))
      }
      await place(tx, ctx, id, input.groupId)
    }
  })
  const before = {
    name: person.name,
    admissionNo: record.admissionNo,
    gender: record.gender,
    group: from ? pathName(ctx, from) : "",
    rollNo: enrolment?.rollNo ?? null,
  }
  const after = {
    name: input.name,
    admissionNo,
    gender: input.gender,
    group: input.groupId ? pathName(ctx, input.groupId) : "",
    rollNo: input.rollNo,
  }
  const personal =
    unseal(SEAL, record.birthDate) !== (input.birthDate || null) ||
    unseal(SEAL, record.phone) !== (input.phone || null) ||
    unseal(SEAL, record.address) !== (input.address || null)
  await writeAudit(
    ctx,
    "records.student_edit",
    `Changed ${input.name}'s record (${admissionNo})`,
    {
      changes: [
        ...changesBetween(before, after, {
          name: "Name",
          admissionNo: "Admission number",
          gender: "Gender",
          group: "Class",
          rollNo: "Roll number",
        }),
        // Personal details are sealed; the log says they changed, not what to.
        ...(personal
          ? [{ field: "Personal details", from: "—", to: "changed" }]
          : []),
      ],
    }
  )
  return { saved: true }
}

/** Marks a student transferred, graduated or withdrawn this year (they leave their class), or active again. */
export async function setStatus(
  slug: string,
  user: User,
  id: string,
  status: (typeof ENROLMENT_STATUSES)[number]
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const { user: person, year, enrolment } = await recordOf(ctx, id)
  if (!year || !enrolment)
    throw new ApiError(
      400,
      "not_enrolled",
      "The student has no class this year."
    )
  needPlace(ctx, enrolment.groupId)
  await getDb().transaction(async (tx) => {
    await tx
      .update(enrolments)
      .set({ status })
      .where(eq(enrolments.id, enrolment.id))
    await place(tx, ctx, id, status === "active" ? enrolment.groupId : null)
  })
  await writeAudit(
    ctx,
    "records.student_status",
    `Marked ${person.name ?? person.email} ${status} in ${year.name}`
  )
  return { status }
}

/** One student's record: details (unsealed), class by year, parents, attendance, campus. */
export async function getStudent(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const { record, user: person, year, enrolment } = await recordOf(ctx, id)
  const groupId = enrolment?.status === "active" ? enrolment.groupId : null
  if (
    !coversGroup(ctx, "students.view", groupId) &&
    !coversGroup(ctx, "students.edit", groupId)
  ) {
    throw notFound("Student not found")
  }
  const db = getDb()
  const [history, parents, marks, campus] = await Promise.all([
    db
      .select({
        year: academicYears.name,
        startsOn: academicYears.startsOn,
        groupId: enrolments.groupId,
        rollNo: enrolments.rollNo,
        status: enrolments.status,
      })
      .from(enrolments)
      .innerJoin(academicYears, eq(enrolments.yearId, academicYears.id))
      .where(and(eq(enrolments.orgId, ctx.org.id), eq(enrolments.userId, id)))
      .orderBy(desc(academicYears.startsOn)),
    db
      .select({
        name: users.name,
        email: users.email,
        relation: guardians.relation,
      })
      .from(guardians)
      .innerJoin(users, eq(guardians.parentId, users.id))
      .where(and(eq(guardians.orgId, ctx.org.id), eq(guardians.studentId, id))),
    db
      .select({ status: attendance.status, present: attendance.present })
      .from(attendance)
      .innerJoin(
        teachingSessions,
        eq(attendance.sessionId, teachingSessions.id)
      )
      .where(
        and(eq(attendance.userId, id), eq(teachingSessions.orgId, ctx.org.id))
      ),
    campusOf(ctx.org, id),
  ])
  const counted = marks.filter((m) => m.status !== "excused")
  return {
    id,
    name: person.name ?? person.email,
    email: isNoLoginEmail(person.email) ? null : person.email,
    admissionNo: record.admissionNo,
    gender: record.gender,
    birthDate: unseal(SEAL, record.birthDate) ?? "",
    phone: unseal(SEAL, record.phone) ?? "",
    address: unseal(SEAL, record.address) ?? "",
    admittedOn: record.admittedOn,
    current: year
      ? {
          year: year.name,
          group: groupId ? { id: groupId, path: pathName(ctx, groupId) } : null,
          rollNo: enrolment?.rollNo ?? null,
          status: enrolment?.status ?? null,
        }
      : null,
    history: history.map((h) => ({
      ...h,
      group: h.groupId ? pathName(ctx, h.groupId) : null,
    })),
    parents: parents.map((p) => ({
      name: p.name ?? p.email,
      email: p.email,
      relation: p.relation,
    })),
    attendance: counted.length
      ? {
          marked: counted.length,
          percent: Math.round(
            (100 * counted.filter((m) => m.present).length) / counted.length
          ),
        }
      : null,
    campus,
    can: {
      edit: coversGroup(ctx, "students.edit", groupId),
      results:
        ctx.modules.has("exams") &&
        (canFor(ctx, "exams.setup", []) ||
          coversGroup(ctx, "exams.view", groupId) ||
          coversGroup(ctx, "exams.marks", groupId)),
    },
  }
}

export const importSchema = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().default(""),
        email: z.string().default(""),
        admissionNo: z.string().default(""),
        gender: z.string().default(""),
        birthDate: z.string().default(""),
        phone: z.string().default(""),
        address: z.string().default(""),
        class: z.string().default(""),
        rollNo: z.string().default(""),
      })
    )
    .min(1)
    .max(3000),
  commit: z.boolean().default(false),
})

/** Students from a spreadsheet: a report per line, then (commit) all of them at once. */
export async function importStudents(
  slug: string,
  user: User,
  input: z.infer<typeof importSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!anyGroupGrant(ctx, "students.edit"))
    throw forbidden("Adding students isn't part of your role.")
  const db = getDb()
  const year = await currentYear(db, ctx.org.id)
  const [records, existing] = await Promise.all([
    db
      .select({ no: studentRecords.admissionNo, userId: studentRecords.userId })
      .from(studentRecords)
      .where(eq(studentRecords.orgId, ctx.org.id)),
    db
      .select({ email: users.email })
      .from(studentRecords)
      .innerJoin(users, eq(studentRecords.userId, users.id))
      .where(eq(studentRecords.orgId, ctx.org.id)),
  ])
  const usedNos = new Set(records.map((r) => r.no.toLowerCase()))
  const students = new Set(existing.map((e) => e.email.toLowerCase()))
  const prefix = admissionPrefix(
    ctx.org.name,
    Number((year?.startsOn ?? (await today())).slice(0, 4))
  )
  const allNos = records.map((r) => r.no)
  const seenEmails = new Set<string>()
  const report = input.rows.map((row, i) => {
    const line = i + 1
    const fail = (note: string) => ({
      line,
      name: row.name.trim(),
      result: "error" as const,
      note,
      input: null,
    })
    const name = row.name.trim()
    if (!name) return fail("No name")
    const email = row.email.trim().toLowerCase()
    if (email && !z.email().safeParse(email).success)
      return fail(`${email} isn't an email address`)
    if (email && (students.has(email) || seenEmails.has(email)))
      return fail(`${email} already has a student record`)
    const gender = GENDERS[row.gender.trim().toLowerCase()]
    if (gender === undefined)
      return fail(`Gender "${row.gender}" isn't female, male or other`)
    const birthDate = asDay(row.birthDate)
    if (birthDate === null)
      return fail(
        `Date of birth "${row.birthDate}" isn't a date like 2019-04-02`
      )
    let groupId: string | null = null
    if (row.class.trim()) {
      const g = groupByPath(ctx, row.class)
      if (!g) return fail(`No class "${row.class}"`)
      if (!isLeaf(ctx, g.id))
        return fail(`"${row.class}" has groups inside it; give a section`)
      if (!year)
        return fail("Add a current academic year before placing students")
      groupId = g.id
    }
    if (!coversGroup(ctx, "students.edit", groupId))
      return fail(
        groupId
          ? `You can't add students to ${row.class}`
          : "You can only add students to your groups"
      )
    const roll = row.rollNo.trim()
    if (roll && !/^\d{1,4}$/.test(roll))
      return fail(`Roll number "${roll}" isn't a number`)
    let admissionNo = row.admissionNo.trim()
    if (admissionNo && usedNos.has(admissionNo.toLowerCase()))
      return fail(`Admission number ${admissionNo} is already used`)
    if (!admissionNo) {
      admissionNo = nextAdmissionNo(prefix, allNos)
    }
    allNos.push(admissionNo)
    usedNos.add(admissionNo.toLowerCase())
    if (email) seenEmails.add(email)
    return {
      line,
      name,
      result: "add" as const,
      note: `${admissionNo}${groupId ? ` · ${pathName(ctx, groupId)}` : " · not placed"}${email ? "" : " · no sign-in"}`,
      input: {
        admissionNo,
        data: {
          name,
          email,
          admissionNo,
          gender,
          birthDate,
          phone: row.phone.trim().slice(0, 30),
          address: row.address.trim().slice(0, 300),
          groupId,
          rollNo: roll ? Number(roll) : null,
        } satisfies z.infer<typeof studentSchema>,
      },
    }
  })
  const adds = report.filter((r) => r.result === "add")
  const summary = { add: adds.length, error: report.length - adds.length }
  if (!input.commit || adds.length === 0) {
    return {
      committed: false,
      summary,
      rows: report.map(({ input: _, ...r }) => r),
    }
  }
  await db.transaction(async (tx) => {
    for (const r of adds)
      await createInTx(tx, ctx, r.input!.data, r.input!.admissionNo, year)
  })
  await writeAudit(ctx, "records.import", `Imported ${adds.length} students`, {
    skipped: summary.error,
  })
  return {
    committed: true,
    summary,
    rows: report.map(({ input: _, ...r }) => r),
  }
}

/** Members sitting in a section, holding no permissions, without a record here. */
export async function unrecorded(ctx: OrgContext) {
  const leafIds = ctx.groups.filter((g) => isLeaf(ctx, g.id)).map((g) => g.id)
  if (leafIds.length === 0) return []
  const db = getDb()
  const [seats, records, staff] = await Promise.all([
    db
      .select({
        userId: groupMembers.userId,
        groupId: groupMembers.groupId,
        name: users.name,
        email: users.email,
      })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.userId, groupMembers.userId),
          eq(orgMembers.orgId, ctx.org.id),
          eq(orgMembers.status, "active")
        )
      )
      .where(inArray(groupMembers.groupId, leafIds)),
    db
      .select({ userId: studentRecords.userId })
      .from(studentRecords)
      .where(eq(studentRecords.orgId, ctx.org.id)),
    getDb()
      .select({
        userId: roleAssignmentsUser.userId,
        systemKey: roleOf.systemKey,
        permissions: roleOf.permissions,
      })
      .from(roleAssignmentsUser)
      .innerJoin(roleOf, eq(roleAssignmentsUser.roleId, roleOf.id))
      .where(eq(roleAssignmentsUser.orgId, ctx.org.id)),
  ])
  const has = new Set(records.map((r) => r.userId))
  const isStaff = new Set(
    staff.filter((s) => rolePermissions(s).length > 0).map((s) => s.userId)
  )
  const seen = new Set<string>()
  return seats.filter(
    (s) =>
      !has.has(s.userId) &&
      !isStaff.has(s.userId) &&
      !seen.has(s.userId) &&
      (seen.add(s.userId), true)
  )
}

/** How many people in classes have no record yet (for the Students page). */
export async function unrecordedCount(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.edit", [])) return { count: 0 }
  return { count: (await unrecorded(ctx)).length }
}

/** Gives everyone already in a class a record and an enrolment in the current year. */
export async function recordEveryone(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.edit", []))
    throw forbidden(
      "Adding students for the whole organization isn't part of your role."
    )
  const db = getDb()
  const year = await currentYear(db, ctx.org.id)
  if (!year)
    throw new ApiError(400, "no_year", "Add the current academic year first.")
  const people = await unrecorded(ctx)
  if (people.length === 0) return { added: 0 }
  const prefix = admissionPrefix(
    ctx.org.name,
    Number(year.startsOn.slice(0, 4))
  )
  const nos = (
    await db
      .select({ no: studentRecords.admissionNo })
      .from(studentRecords)
      .where(eq(studentRecords.orgId, ctx.org.id))
  ).map((r) => r.no)
  const admitted = await today()
  await db.transaction(async (tx) => {
    for (const p of people) {
      const no = nextAdmissionNo(prefix, nos)
      nos.push(no)
      await tx.insert(studentRecords).values({
        orgId: ctx.org.id,
        userId: p.userId,
        admissionNo: no,
        admittedOn: admitted,
      })
      await tx
        .insert(enrolments)
        .values({
          orgId: ctx.org.id,
          yearId: year.id,
          userId: p.userId,
          groupId: p.groupId,
        })
        .onConflictDoNothing()
    }
  })
  await writeAudit(
    ctx,
    "records.adopt",
    `Created records for ${people.length} students already in classes`
  )
  return { added: people.length }
}

/** A section's students this year, with what an ID card shows. Those who may see them only. */
export async function idCardData(slug: string, user: User, groupId: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!isLeaf(ctx, groupId)) throw notFound("Class not found")
  if (
    !coversGroup(ctx, "students.view", groupId) &&
    !coversGroup(ctx, "students.edit", groupId)
  )
    throw forbidden("Seeing these students isn't part of your role.")
  const db = getDb()
  const year = await currentYear(db, ctx.org.id)
  if (!year)
    throw new ApiError(400, "no_year", "Add the current academic year first.")
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      rollNo: enrolments.rollNo,
      admissionNo: studentRecords.admissionNo,
      birthDate: studentRecords.birthDate,
      phone: studentRecords.phone,
    })
    .from(enrolments)
    .innerJoin(users, eq(enrolments.userId, users.id))
    .innerJoin(
      studentRecords,
      and(
        eq(studentRecords.orgId, enrolments.orgId),
        eq(studentRecords.userId, enrolments.userId)
      )
    )
    .where(
      and(
        eq(enrolments.yearId, year.id),
        eq(enrolments.groupId, groupId),
        eq(enrolments.status, "active")
      )
    )
  const parents = rows.length
    ? await db
        .select({
          studentId: guardians.studentId,
          name: users.name,
          email: users.email,
        })
        .from(guardians)
        .innerJoin(users, eq(guardians.parentId, users.id))
        .where(
          and(
            eq(guardians.orgId, ctx.org.id),
            inArray(
              guardians.studentId,
              rows.map((r) => r.id)
            )
          )
        )
    : []
  await writeAudit(
    ctx,
    "records.id_cards",
    `Printed ID cards for ${pathName(ctx, groupId)}`,
    { groupId }
  )
  return {
    org: { name: ctx.org.name },
    year: year.name,
    class: pathName(ctx, groupId),
    students: rows
      .map((r) => ({
        name: r.name ?? r.email,
        rollNo: r.rollNo,
        admissionNo: r.admissionNo,
        birthDate: unseal(SEAL, r.birthDate) ?? "",
        phone: unseal(SEAL, r.phone) ?? "",
        parent: (() => {
          const p = parents.find((x) => x.studentId === r.id)
          return p ? (p.name ?? p.email) : ""
        })(),
      }))
      .sort(
        (a, b) =>
          (a.rollNo ?? 1e9) - (b.rollNo ?? 1e9) || a.name.localeCompare(b.name)
      ),
  }
}
