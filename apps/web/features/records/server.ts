import { randomUUID } from "node:crypto"

import {
  academicYears,
  attendance,
  classTeachers,
  transferCertificates,
  enrolments,
  getDb,
  groupMembers,
  guardians,
  orgMembers,
  orgRoles as roleOf,
  roleAssignments as roleAssignmentsUser,
  sql,
  studentRecords,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import {
  admissionPrefix,
  changesBetween,
  enabledModules,
  KINDS,
  ENROLMENT_STATUSES,
  isNoLoginEmail,
  nextAdmissionNo,
  nextSerial,
  noLoginEmail,
  suggestPromotion,
  yearProblem,
  type Permission,
} from "@workspace/judge"
import { z } from "zod"

import { anyGroupGrant, covers, pathName } from "@/features/campus/people"
import { teachersOfGroups } from "@/features/classes/server"
import { campusOf } from "@/features/campus/server"
import { rolePermissions } from "@/features/orgs/access"
import { today } from "@/features/catalog/server"
import {
  canFor,
  orgContext,
  userByEmail,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { seal, unseal } from "@/lib/sealed"

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

const { and, asc, count, desc, eq, ilike, inArray, ne, or } = sql

const SEAL = "student record"

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give a date")

export const yearSchema = z.object({
  name: z.string().trim().min(2).max(40),
  startsOn: day,
  endsOn: day,
  isCurrent: z.boolean().optional(),
})

export const studentSchema = z.object({
  name: z.string().trim().min(1, "Give the student's name").max(120),
  /** Empty: a student who doesn't sign in. */
  email: z.union([z.literal(""), z.email("Not an email address")]).default(""),
  admissionNo: z.string().trim().max(40).default(""),
  gender: z.enum(["", "female", "male", "other"]).default(""),
  birthDate: z.union([z.literal(""), day]).default(""),
  phone: z.string().trim().max(30).default(""),
  address: z.string().trim().max(300).default(""),
  /** The group (section) for the current year; null: not placed. */
  groupId: z.uuid().nullable().default(null),
  rollNo: z.number().int().min(1).max(9999).nullable().default(null),
})

export const statusSchema = z.object({ status: z.enum(ENROLMENT_STATUSES) })

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

function needModule(ctx: OrgContext) {
  if (!ctx.modules.has("records")) {
    throw notFound("Student records aren't switched on for this organization.")
  }
}

const isLeaf = (ctx: OrgContext, groupId: string) =>
  ctx.groups.some((g) => g.id === groupId) &&
  !ctx.groups.some((g) => g.parentId === groupId)

/** Whether a permission covers a student placed in this group (or, unplaced, the whole org). */
const coversGroup = (ctx: OrgContext, p: Permission, groupId: string | null) =>
  covers(ctx, p, groupId ? [groupId] : [])

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]
type Db = ReturnType<typeof getDb> | Tx

async function currentYear(db: Db, orgId: string) {
  const [y] = await db
    .select()
    .from(academicYears)
    .where(
      and(eq(academicYears.orgId, orgId), eq(academicYears.isCurrent, true))
    )
  return y ?? null
}

/** Seats one student in exactly this group of the organization (or none). */
async function place(
  db: Db,
  ctx: OrgContext,
  userId: string,
  groupId: string | null
) {
  const ids = ctx.groups.map((g) => g.id)
  if (ids.length) {
    await db
      .delete(groupMembers)
      .where(
        and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, ids))
      )
  }
  if (groupId)
    await db
      .insert(groupMembers)
      .values({ groupId, userId })
      .onConflictDoNothing()
}

/** Every student's place becomes their active enrolment in this year. */
async function syncPlaces(db: Db, ctx: OrgContext, yearId: string) {
  const students = await db
    .select({ userId: studentRecords.userId })
    .from(studentRecords)
    .where(eq(studentRecords.orgId, ctx.org.id))
  const ids = students.map((s) => s.userId)
  if (ids.length === 0) return
  const groupIds = ctx.groups.map((g) => g.id)
  if (groupIds.length) {
    await db
      .delete(groupMembers)
      .where(
        and(
          inArray(groupMembers.userId, ids),
          inArray(groupMembers.groupId, groupIds)
        )
      )
  }
  const seats = await db
    .select({ userId: enrolments.userId, groupId: enrolments.groupId })
    .from(enrolments)
    .where(and(eq(enrolments.yearId, yearId), eq(enrolments.status, "active")))
  const rows = seats.filter((s): s is { userId: string; groupId: string } =>
    Boolean(s.groupId)
  )
  if (rows.length)
    await db.insert(groupMembers).values(rows).onConflictDoNothing()
}

/* ---------- academic years ---------- */

export async function listYears(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const can = { years: canFor(ctx, "students.years", []) }
  if (
    !can.years &&
    !anyGroupGrant(ctx, "students.view") &&
    !anyGroupGrant(ctx, "students.edit")
  ) {
    throw forbidden("Student records aren't part of your role.")
  }
  const db = getDb()
  const [years, counts] = await Promise.all([
    db
      .select()
      .from(academicYears)
      .where(eq(academicYears.orgId, ctx.org.id))
      .orderBy(desc(academicYears.startsOn)),
    db
      .select({ yearId: enrolments.yearId, n: count() })
      .from(enrolments)
      .where(eq(enrolments.orgId, ctx.org.id))
      .groupBy(enrolments.yearId),
  ])
  return {
    terms: KINDS[ctx.org.type].terms,
    can,
    years: years.map((y) => ({
      id: y.id,
      name: y.name,
      startsOn: y.startsOn,
      endsOn: y.endsOn,
      isCurrent: y.isCurrent,
      enrolled: Number(counts.find((c) => c.yearId === y.id)?.n ?? 0),
    })),
  }
}

async function yearOf(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Academic year not found")
  const [y] = await getDb()
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.id, id), eq(academicYears.orgId, ctx.org.id)))
  if (!y) throw notFound("Academic year not found")
  return y
}

async function nameFree(ctx: OrgContext, name: string, except?: string) {
  const [clash] = await getDb()
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(
      and(eq(academicYears.orgId, ctx.org.id), ilike(academicYears.name, name))
    )
  if (clash && clash.id !== except)
    throw new ApiError(
      409,
      "duplicate",
      `There's already a year called ${name}.`
    )
}

/** Makes a year the current one: every student moves to their place in it. */
async function makeCurrent(tx: Tx, ctx: OrgContext, yearId: string) {
  await tx
    .update(academicYears)
    .set({ isCurrent: false })
    .where(
      and(eq(academicYears.orgId, ctx.org.id), ne(academicYears.id, yearId))
    )
  await tx
    .update(academicYears)
    .set({ isCurrent: true })
    .where(eq(academicYears.id, yearId))
  await syncPlaces(tx, ctx, yearId)
}

export async function addYear(
  slug: string,
  user: User,
  input: z.infer<typeof yearSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden("Academic years aren't part of your role.")
  const problem = yearProblem(input)
  if (problem) throw new ApiError(400, "bad_year", problem)
  await nameFree(ctx, input.name)
  const id = await getDb().transaction(async (tx) => {
    const [y] = await tx
      .insert(academicYears)
      .values({
        orgId: ctx.org.id,
        name: input.name,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      })
      .returning({ id: academicYears.id })
    if (input.isCurrent) await makeCurrent(tx, ctx, y!.id)
    return y!.id
  })
  await writeAudit(
    ctx,
    "records.year_add",
    `Added the academic year ${input.name}${input.isCurrent ? " (current)" : ""}`
  )
  return { id }
}

export async function updateYear(
  slug: string,
  user: User,
  id: string,
  input: Partial<z.infer<typeof yearSchema>>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden("Academic years aren't part of your role.")
  const year = await yearOf(ctx, id)
  const next = {
    name: input.name ?? year.name,
    startsOn: input.startsOn ?? year.startsOn,
    endsOn: input.endsOn ?? year.endsOn,
  }
  const problem = yearProblem(next)
  if (problem) throw new ApiError(400, "bad_year", problem)
  if (input.name) await nameFree(ctx, input.name, id)
  await getDb().transaction(async (tx) => {
    await tx.update(academicYears).set(next).where(eq(academicYears.id, id))
    if (input.isCurrent === true && !year.isCurrent)
      await makeCurrent(tx, ctx, id)
    if (input.isCurrent === false && year.isCurrent) {
      await tx
        .update(academicYears)
        .set({ isCurrent: false })
        .where(eq(academicYears.id, id))
    }
  })
  const changes = changesBetween(
    { ...year, isCurrent: year.isCurrent },
    { ...next, isCurrent: input.isCurrent ?? year.isCurrent },
    { name: "Name", startsOn: "Starts", endsOn: "Ends", isCurrent: "Current" }
  )
  await writeAudit(
    ctx,
    input.isCurrent === true && !year.isCurrent
      ? "records.year_current"
      : "records.year_edit",
    input.isCurrent === true && !year.isCurrent
      ? `Made ${next.name} the current academic year`
      : `Changed the academic year ${next.name}`,
    { changes }
  )
  return { saved: true }
}

export async function deleteYear(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden("Academic years aren't part of your role.")
  const year = await yearOf(ctx, id)
  const [{ n } = { n: 0 }] = await getDb()
    .select({ n: count() })
    .from(enrolments)
    .where(eq(enrolments.yearId, id))
  if (Number(n) > 0) {
    throw new ApiError(
      400,
      "in_use",
      `${n} students are enrolled in ${year.name}. Only a year with no one in it can be deleted.`
    )
  }
  await getDb().delete(academicYears).where(eq(academicYears.id, id))
  await writeAudit(
    ctx,
    "records.year_delete",
    `Deleted the academic year ${year.name}`
  )
  return { deleted: true }
}

/* ---------- students ---------- */

const PAGE = 50

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

/** A group and its ancestors' ids, own first. */
function pathIds(ctx: OrgContext, groupId: string) {
  const out: string[] = []
  for (
    let g = ctx.groups.find((x) => x.id === groupId);
    g;
    g = g.parentId ? ctx.groups.find((x) => x.id === g!.parentId) : undefined
  ) {
    out.push(g.id)
  }
  return out
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

function needPlace(ctx: OrgContext, groupId: string | null) {
  if (groupId && !isLeaf(ctx, groupId)) {
    throw new ApiError(
      400,
      "not_a_section",
      "Choose a class or section with no groups inside it."
    )
  }
  if (!coversGroup(ctx, "students.edit", groupId)) {
    throw forbidden(
      groupId
        ? "Adding students to that group isn't part of your role."
        : "Adding students outside your groups isn't part of your role."
    )
  }
}

const sealed = (v: string) => (v ? seal(SEAL, v) : null)

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

async function recordOf(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Student not found")
  const db = getDb()
  const year = await currentYear(db, ctx.org.id)
  const [row] = await db
    .select({ record: studentRecords, user: users })
    .from(studentRecords)
    .innerJoin(users, eq(studentRecords.userId, users.id))
    .where(
      and(eq(studentRecords.orgId, ctx.org.id), eq(studentRecords.userId, id))
    )
  if (!row) throw notFound("Student not found")
  const [enrolment] = year
    ? await db
        .select()
        .from(enrolments)
        .where(and(eq(enrolments.yearId, year.id), eq(enrolments.userId, id)))
    : []
  return { ...row, year, enrolment: enrolment ?? null }
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

/* ---------- promotion to another year ---------- */

const target = z.union([
  z.uuid(),
  z.literal("graduate"),
  z.literal("repeat"),
  z.literal("withdraw"),
])

export const promoteSchema = z.object({
  fromYearId: z.uuid(),
  toYearId: z.uuid(),
  /** Each section's students go to a group, graduate, stay (repeat) or leave. */
  sections: z.record(z.string(), target),
  /** One student's own destination, over their section's. */
  exceptions: z.record(z.string(), target).default({}),
  makeCurrent: z.boolean().default(false),
  /** false: only count what would happen. */
  apply: z.boolean().default(false),
})

function needPromote(ctx: OrgContext) {
  if (!canFor(ctx, "students.years", []) || !canFor(ctx, "students.edit", [])) {
    throw forbidden(
      "Promoting students needs Academic years and Add and edit students for the whole organization."
    )
  }
}

/** Every active student of a year, by section, with a suggested destination for each section. */
export async function promotionPlan(
  slug: string,
  user: User,
  fromYearId: string,
  toYearId: string
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needPromote(ctx)
  const [from, to] = await Promise.all([
    yearOf(ctx, fromYearId),
    yearOf(ctx, toYearId),
  ])
  if (from.id === to.id)
    throw new ApiError(400, "same_year", "Choose two different years.")
  const db = getDb()
  const [rows, already] = await Promise.all([
    db
      .select({
        userId: enrolments.userId,
        groupId: enrolments.groupId,
        rollNo: enrolments.rollNo,
        name: users.name,
        email: users.email,
      })
      .from(enrolments)
      .innerJoin(users, eq(enrolments.userId, users.id))
      .where(
        and(eq(enrolments.yearId, from.id), eq(enrolments.status, "active"))
      )
      .orderBy(asc(enrolments.rollNo), asc(users.name)),
    db
      .select({ userId: enrolments.userId })
      .from(enrolments)
      .where(eq(enrolments.yearId, to.id)),
  ])
  const placed = new Set(already.map((a) => a.userId))
  const sectionIds = [
    ...new Set(rows.flatMap((r) => (r.groupId ? [r.groupId] : []))),
  ]
  const suggested = suggestPromotion(ctx.groups, sectionIds)
  return {
    from: { id: from.id, name: from.name, isCurrent: from.isCurrent },
    to: { id: to.id, name: to.name, isCurrent: to.isCurrent },
    sections: sectionIds
      .map((id) => ({
        groupId: id,
        path: pathName(ctx, id),
        suggested: suggested[id] ?? "repeat",
        students: rows
          .filter((r) => r.groupId === id)
          .map((r) => ({
            id: r.userId,
            name: r.name ?? r.email,
            rollNo: r.rollNo,
            already: placed.has(r.userId),
          })),
      }))
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true })
      ),
    targets: ctx.groups
      .filter((g) => isLeaf(ctx, g.id))
      .map((g) => ({ id: g.id, path: pathName(ctx, g.id) }))
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true })
      ),
  }
}

/**
 * Moves a year's students on: each gets an enrolment in the other year (their section's
 * destination, or their own), or graduates or leaves (their enrolment this year says so).
 * Anyone already enrolled in the other year is skipped, so it can be run again. Places
 * change only if the other year is made current here (or later).
 */
export async function promote(
  slug: string,
  user: User,
  input: z.infer<typeof promoteSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needPromote(ctx)
  const [from, to] = await Promise.all([
    yearOf(ctx, input.fromYearId),
    yearOf(ctx, input.toYearId),
  ])
  if (from.id === to.id)
    throw new ApiError(400, "same_year", "Choose two different years.")
  for (const t of [
    ...Object.values(input.sections),
    ...Object.values(input.exceptions),
  ]) {
    if (!["graduate", "repeat", "withdraw"].includes(t) && !isLeaf(ctx, t)) {
      throw new ApiError(
        400,
        "not_a_section",
        "Every destination must be a class or section with nothing inside it."
      )
    }
  }
  const db = getDb()
  const [rows, already] = await Promise.all([
    db
      .select({
        id: enrolments.id,
        userId: enrolments.userId,
        groupId: enrolments.groupId,
        rollNo: enrolments.rollNo,
      })
      .from(enrolments)
      .where(
        and(eq(enrolments.yearId, from.id), eq(enrolments.status, "active"))
      ),
    db
      .select({ userId: enrolments.userId })
      .from(enrolments)
      .where(eq(enrolments.yearId, to.id)),
  ])
  const placed = new Set(already.map((a) => a.userId))
  const plan = rows.map((r) => {
    const t =
      input.exceptions[r.userId] ??
      (r.groupId ? input.sections[r.groupId] : undefined) ??
      "repeat"
    const kind = placed.has(r.userId)
      ? "skipped"
      : t === "graduate"
        ? "graduated"
        : t === "withdraw"
          ? "withdrawn"
          : t === "repeat"
            ? "repeated"
            : "moved"
    return { ...r, to: t === "repeat" ? r.groupId : t, kind }
  })
  const counts = {
    moved: 0,
    repeated: 0,
    graduated: 0,
    withdrawn: 0,
    skipped: 0,
  }
  for (const p of plan) counts[p.kind as keyof typeof counts]++
  if (!input.apply) return { applied: false, counts }
  await db.transaction(async (tx) => {
    for (const p of plan) {
      if (p.kind === "skipped") continue
      if (p.kind === "graduated" || p.kind === "withdrawn") {
        await tx
          .update(enrolments)
          .set({ status: p.kind })
          .where(eq(enrolments.id, p.id))
        continue
      }
      await tx.insert(enrolments).values({
        orgId: ctx.org.id,
        yearId: to.id,
        userId: p.userId,
        groupId: p.to,
        rollNo: p.kind === "repeated" ? p.rollNo : null,
      })
    }
    if (input.makeCurrent) await makeCurrent(tx, ctx, to.id)
    // Graduates and leavers of the current year leave their classes now.
    else if (from.isCurrent) await syncPlaces(tx, ctx, from.id)
  })
  await writeAudit(
    ctx,
    "records.promote",
    `Promoted ${from.name} to ${to.name}: ${counts.moved} moved up, ${counts.repeated} staying, ${counts.graduated} graduated, ${counts.withdrawn} leaving${input.makeCurrent ? `; ${to.name} is now current` : ""}`,
    { counts }
  )
  return { applied: true, counts }
}

/* ---------- import ---------- */

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

const GENDERS: Record<string, "" | "female" | "male" | "other"> = {
  "": "",
  f: "female",
  female: "female",
  girl: "female",
  m: "male",
  male: "male",
  boy: "male",
  o: "other",
  other: "other",
}

/** "2019-04-02", "02/04/2019" (day first) or "2/4/2019", as "YYYY-MM-DD"; null if neither. */
function asDay(text: string) {
  const t = text.trim()
  if (!t) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
  return m
    ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`
    : null
}

/** A class written as a path, "Grade 3 / A" or "Grade 3 › A", to its group. */
function groupByPath(ctx: OrgContext, path: string) {
  const parts = path
    .split(/\s*(?:\/|›|>)\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  let parent: string | null = null
  let found: (typeof ctx.groups)[number] | undefined
  for (const part of parts) {
    found = ctx.groups.find(
      (g) => g.parentId === parent && g.name.toLowerCase() === part
    )
    if (!found) return null
    parent = found.id
  }
  return found ?? null
}

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

/* ---------- records for people already in classes ---------- */

/** Members sitting in a section, holding no permissions, without a record here. */
async function unrecorded(ctx: OrgContext) {
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

/* ---------- class teachers ---------- */

export const classTeachersSchema = z.object({
  assignments: z
    .array(z.object({ groupId: z.uuid(), teacherId: z.uuid().nullable() }))
    .max(1000),
})

async function ownYear(ctx: OrgContext, yearId: string) {
  if (!z.uuid().safeParse(yearId).success) throw notFound("Year not found")
  const [year] = await getDb()
    .select()
    .from(academicYears)
    .where(
      and(eq(academicYears.id, yearId), eq(academicYears.orgId, ctx.org.id))
    )
  if (!year) throw notFound("Year not found")
  return year
}

/** Each section's class teacher for a year, and who could be (those teaching it). */
export async function classTeachersOf(
  slug: string,
  user: User,
  yearId: string
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden('Choosing class teachers needs "Academic years".')
  const year = await ownYear(ctx, yearId)
  const sections = ctx.groups.filter((g) => isLeaf(ctx, g.id))
  const [rows, options] = await Promise.all([
    getDb()
      .select()
      .from(classTeachers)
      .where(eq(classTeachers.yearId, year.id)),
    teachersOfGroups(
      ctx,
      sections.map((g) => g.id)
    ),
  ])
  return {
    year: { id: year.id, name: year.name },
    sections: sections
      .map((g) => ({
        groupId: g.id,
        name: pathName(ctx, g.id),
        teacherId: rows.find((r) => r.groupId === g.id)?.teacherId ?? null,
        options: (options.get(g.id) ?? []).map((t) => ({
          id: t.id,
          name: t.name,
        })),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      ),
  }
}

export async function setClassTeachers(
  slug: string,
  user: User,
  yearId: string,
  input: z.infer<typeof classTeachersSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden('Choosing class teachers needs "Academic years".')
  const year = await ownYear(ctx, yearId)
  for (const a of input.assignments)
    if (!isLeaf(ctx, a.groupId))
      throw new ApiError(
        400,
        "not_a_section",
        "Class teachers are for sections."
      )
  const options = await teachersOfGroups(
    ctx,
    input.assignments.map((a) => a.groupId)
  )
  for (const a of input.assignments) {
    if (
      a.teacherId &&
      !(options.get(a.groupId) ?? []).some((t) => t.id === a.teacherId)
    )
      throw new ApiError(
        400,
        "not_a_teacher",
        `Only someone teaching ${pathName(ctx, a.groupId)} can be its class teacher.`
      )
  }
  const before = await getDb()
    .select()
    .from(classTeachers)
    .where(eq(classTeachers.yearId, year.id))
  const changed = input.assignments.filter(
    (a) =>
      (before.find((b) => b.groupId === a.groupId)?.teacherId ?? null) !==
      a.teacherId
  )
  if (changed.length === 0) return classTeachersOf(slug, user, yearId)
  await getDb().transaction(async (tx) => {
    const cleared = changed.filter((a) => !a.teacherId).map((a) => a.groupId)
    if (cleared.length)
      await tx
        .delete(classTeachers)
        .where(
          and(
            eq(classTeachers.yearId, year.id),
            inArray(classTeachers.groupId, cleared)
          )
        )
    const set = changed.filter((a) => a.teacherId)
    if (set.length)
      await tx
        .insert(classTeachers)
        .values(
          set.map((a) => ({
            orgId: ctx.org.id,
            yearId: year.id,
            groupId: a.groupId,
            teacherId: a.teacherId!,
          }))
        )
        .onConflictDoUpdate({
          target: [classTeachers.yearId, classTeachers.groupId],
          set: { teacherId: sql.sql`excluded.teacher_id` },
        })
  })
  await writeAudit(
    ctx,
    "records.class_teachers",
    `Set the class teachers of ${changed.length} sections for ${year.name}`,
    { yearId: year.id }
  )
  return classTeachersOf(slug, user, yearId)
}

/* ---------- transfer certificates ---------- */

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

const TC_SEAL = "transfer certificate"

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

/* ---------- ID cards ---------- */

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
