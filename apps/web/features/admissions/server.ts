import {
  academicYears,
  admissionApplications,
  getDb,
  guardians,
  organizations,
  sql,
  users,
  type User,
} from "@workspace/db"
import {
  applicationProblem,
  APPLICATION_STATUSES,
  canMoveTo,
  enabledModules,
  nextApplicationNo,
  OPEN_STATUSES,
  readAdmissionSettings,
  type ApplicationStatus,
} from "@workspace/judge"
import { z } from "zod"

import { pathName } from "@/features/campus/people"
import { today } from "@/features/catalog/server"
import { notify } from "@/features/notifications/server"
import {
  canFor,
  membersWhoCan,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import {
  admissionFree,
  createInTx,
  suggestAdmissionNo,
} from "@/features/records/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { seal, unseal } from "@/lib/sealed"

/*
 * Admissions (a module; needs Student records). A signed-in applicant (a parent, or the
 * student themselves) applies for a grade in the academic year the school is admitting
 * for. The office ("Manage admissions") moves applications through reviewing, waitlisted
 * and rejected, and admits: that creates the student's record and account (through
 * Student records, with an admission number), enrols them in a section for that year
 * (their place now too, if it's the current year), and links the applicant as their parent
 * (Parent accounts). Each decision is told to the applicant. Birth date, phone and address
 * are sealed. Rules in packages/judge/src/admissions.ts.
 */

const { and, count, desc, eq, ilike, inArray, or } = sql

const SEAL = "admission"
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give a date")

export const applySchema = z.object({
  gradeId: z.uuid("Choose the class"),
  studentName: z.string().trim().min(2, "Give the student's full name").max(120),
  birthDate: day,
  gender: z.enum(["", "female", "male", "other"]).default(""),
  previousSchool: z.string().trim().max(200).default(""),
  parentName: z.string().trim().min(2, "Give your name").max(120),
  relation: z.enum(["mother", "father", "guardian", "self"]).default("guardian"),
  phone: z.string().trim().min(7).max(20),
  address: z.string().trim().max(300).default(""),
  notes: z.string().trim().max(1000).default(""),
})

export const statusSchema = z.object({
  status: z.enum(["reviewing", "waitlisted", "rejected"]),
  message: z.string().trim().max(500).default(""),
})

export const admitSchema = z.object({
  groupId: z.uuid("Choose the section"),
  rollNo: z.number().int().min(1).max(9999).nullable().default(null),
  admissionNo: z.string().trim().max(40).default(""),
  /** The student's own sign-in; empty: a student who doesn't sign in. */
  email: z.union([z.literal(""), z.email("Not an email address")]).default(""),
  message: z.string().trim().max(500).default(""),
})

export const settingsSchema = z.object({
  open: z.boolean(),
  yearId: z.uuid().nullable(),
  gradeIds: z.array(z.uuid()).max(200),
  instructions: z.string().trim().max(2000).default(""),
})

export const listSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  gradeId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
})

const forbidden = (message: string) => new ApiError(403, "forbidden", message)
const conflict = (code: string, message: string) => new ApiError(409, code, message)

const STATUS_WORDS: Record<ApplicationStatus, string> = {
  submitted: "received",
  reviewing: "being reviewed",
  waitlisted: "on the waiting list",
  rejected: "not successful this time",
  admitted: "successful: admitted",
  withdrawn: "withdrawn",
}

async function context(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const modules = ctx.modules
  if (!modules.has("admissions"))
    throw notFound("Admissions aren't open here.")
  if (!modules.has("records"))
    throw conflict("needs_modules", "Admissions need the Student records module switched on.")
  return ctx
}

const manages = (ctx: OrgContext) => canFor(ctx, "admissions.manage", [])
const needManage = (ctx: OrgContext) => {
  if (!manages(ctx)) throw forbidden("Managing admissions isn't part of your role.")
}
const settingsOf = (ctx: OrgContext) => readAdmissionSettings(ctx.org.moduleSettings)

/** The grades (top-level groups) taking applications: those chosen, else all. */
function gradesOpen(ctx: OrgContext) {
  const top = ctx.groups.filter((g) => !g.parentId)
  const chosen = settingsOf(ctx).gradeIds
  return (chosen.length ? top.filter((g) => chosen.includes(g.id)) : top).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  )
}

/** The sections at or under a grade, where an admitted student can be placed. */
function sectionsUnder(ctx: OrgContext, gradeId: string) {
  const out: string[] = []
  const walk = (id: string) => {
    const kids = ctx.groups.filter((g) => g.parentId === id)
    if (kids.length === 0) out.push(id)
    else kids.forEach((k) => walk(k.id))
  }
  if (ctx.groups.some((g) => g.id === gradeId)) walk(gradeId)
  return out
}

async function yearById(orgId: string, id: string | null) {
  if (!id) return null
  const [y] = await getDb()
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.id, id), eq(academicYears.orgId, orgId)))
  return y ?? null
}

type Row = typeof admissionApplications.$inferSelect

/** An application as the applicant sees it. */
const forApplicant = (ctx: OrgContext, r: Row) => ({
  id: r.id,
  number: r.number,
  studentName: r.studentName,
  grade: r.gradeId ? pathName(ctx, r.gradeId) : null,
  status: r.status as ApplicationStatus,
  message: r.message,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
  canWithdraw: OPEN_STATUSES.includes(r.status as ApplicationStatus),
})

/* ---------- applying ---------- */

/** The form: whether admissions are open, for which year and grades, and your applications. */
export async function admissionForm(slug: string, user: User) {
  const ctx = await context(slug, user)
  const settings = settingsOf(ctx)
  const year = await yearById(ctx.org.id, settings.yearId)
  const mine = await getDb()
    .select()
    .from(admissionApplications)
    .where(
      and(
        eq(admissionApplications.orgId, ctx.org.id),
        eq(admissionApplications.applicantId, user.id)
      )
    )
    .orderBy(desc(admissionApplications.createdAt))
  return {
    org: { name: ctx.org.name, slug: ctx.org.slug, type: ctx.org.type },
    open: settings.open && !!year,
    year: year ? { id: year.id, name: year.name } : null,
    grades: gradesOpen(ctx).map((g) => ({ id: g.id, name: g.name })),
    instructions: settings.instructions,
    applicant: { name: user.name ?? "", email: user.email },
    mine: mine.map((r) => forApplicant(ctx, r)),
  }
}

/** Sends an application. */
export async function apply(slug: string, user: User, input: z.infer<typeof applySchema>) {
  const ctx = await context(slug, user)
  const settings = settingsOf(ctx)
  const year = await yearById(ctx.org.id, settings.yearId)
  if (!settings.open || !year)
    throw conflict("closed", `${ctx.org.name} isn't taking applications now.`)
  if (!gradesOpen(ctx).some((g) => g.id === input.gradeId))
    throw new ApiError(400, "bad_grade", "That class isn't taking applications.")
  const problem = applicationProblem(input, await today())
  if (problem) throw new ApiError(400, "bad_application", problem)
  const db = getDb()
  const mine = await db
    .select()
    .from(admissionApplications)
    .where(
      and(
        eq(admissionApplications.orgId, ctx.org.id),
        eq(admissionApplications.applicantId, user.id),
        inArray(admissionApplications.status, OPEN_STATUSES)
      )
    )
  // One open application per child, and a few at most, so the form can't be flooded.
  const same = mine.find(
    (r) =>
      r.studentName.toLowerCase() === input.studentName.toLowerCase() &&
      unseal(SEAL, r.birthDate) === input.birthDate
  )
  if (same)
    throw conflict("duplicate", `You've already applied for ${input.studentName} (${same.number}).`)
  if (mine.length >= 5)
    throw conflict("too_many", "You have 5 applications waiting already. Withdraw one to apply again.")
  const row = await db.transaction(async (tx) => {
    // Numbers are taken under a lock on the organization, so two at once don't clash.
    await tx.execute(sql.sql`select 1 from organizations where id = ${ctx.org.id} for update`)
    const used = await tx
      .select({ n: admissionApplications.number })
      .from(admissionApplications)
      .where(eq(admissionApplications.orgId, ctx.org.id))
    const number = nextApplicationNo(Number(year.startsOn.slice(0, 4)), used.map((u) => u.n))
    const [created] = await tx
      .insert(admissionApplications)
      .values({
        orgId: ctx.org.id,
        number,
        yearId: year.id,
        gradeId: input.gradeId,
        applicantId: user.id,
        studentName: input.studentName,
        birthDate: seal(SEAL, input.birthDate),
        gender: input.gender,
        previousSchool: input.previousSchool,
        parentName: input.parentName,
        relation: input.relation,
        phone: seal(SEAL, input.phone),
        address: input.address ? seal(SEAL, input.address) : null,
        notes: input.notes,
      })
      .returning()
    return created!
  })
  if (!user.name)
    await db.update(users).set({ name: input.parentName }).where(eq(users.id, user.id))
  await writeAudit(
    ctx,
    "admission.apply",
    `${input.parentName} applied for ${input.studentName} to ${pathName(ctx, input.gradeId)} (${row.number})`,
    { applicationId: row.id }
  )
  await notify(
    (await membersWhoCan(ctx.org.id, "admissions.manage")).filter((id) => id !== user.id),
    {
      kind: "admission_new",
      title: `New application: ${input.studentName} for ${pathName(ctx, input.gradeId)}`,
      body: `${row.number}, from ${input.parentName}.`,
      href: `/orgs/${ctx.org.slug}/manage/admissions/${row.id}`,
      orgId: ctx.org.id,
    }
  )
  return forApplicant(ctx, row)
}

async function ownApplication(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Application not found")
  const [row] = await getDb()
    .select()
    .from(admissionApplications)
    .where(and(eq(admissionApplications.id, id), eq(admissionApplications.orgId, ctx.org.id)))
  if (!row) throw notFound("Application not found")
  return row
}

export async function withdraw(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  const row = await ownApplication(ctx, id)
  if (row.applicantId !== user.id) throw notFound("Application not found")
  if (!OPEN_STATUSES.includes(row.status as ApplicationStatus))
    throw conflict("decided", `This application is already ${row.status}.`)
  await getDb()
    .update(admissionApplications)
    .set({ status: "withdrawn" })
    .where(eq(admissionApplications.id, id))
  await writeAudit(ctx, "admission.withdraw", `Withdrew application ${row.number} (${row.studentName})`, {
    applicationId: id,
  })
  return { ok: true }
}

/* ---------- the office ---------- */

export async function listApplications(
  slug: string,
  user: User,
  filters: z.infer<typeof listSchema>
) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const db = getDb()
  const where = [eq(admissionApplications.orgId, ctx.org.id)]
  if (filters.status) where.push(eq(admissionApplications.status, filters.status))
  if (filters.gradeId) where.push(eq(admissionApplications.gradeId, filters.gradeId))
  if (filters.q) {
    const like = `%${filters.q.replace(/[%_]/g, "")}%`
    where.push(
      or(
        ilike(admissionApplications.studentName, like),
        ilike(admissionApplications.parentName, like),
        ilike(admissionApplications.number, like)
      )!
    )
  }
  const page = filters.page ?? 1
  const [rows, [total], byStatus] = await Promise.all([
    db
      .select({ app: admissionApplications, email: users.email })
      .from(admissionApplications)
      .innerJoin(users, eq(admissionApplications.applicantId, users.id))
      .where(and(...where))
      .orderBy(desc(admissionApplications.createdAt))
      .limit(50)
      .offset((page - 1) * 50),
    db.select({ n: count() }).from(admissionApplications).where(and(...where)),
    db
      .select({ status: admissionApplications.status, n: count() })
      .from(admissionApplications)
      .where(eq(admissionApplications.orgId, ctx.org.id))
      .groupBy(admissionApplications.status),
  ])
  const settings = settingsOf(ctx)
  const year = await yearById(ctx.org.id, settings.yearId)
  return {
    total: Number(total?.n ?? 0),
    page,
    counts: Object.fromEntries(byStatus.map((s) => [s.status, Number(s.n)])),
    settings: { ...settings, yearName: year?.name ?? null },
    grades: ctx.groups
      .filter((g) => !g.parentId)
      .map((g) => ({ id: g.id, name: g.name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    applications: rows.map(({ app, email }) => ({
      id: app.id,
      number: app.number,
      studentName: app.studentName,
      grade: app.gradeId ? pathName(ctx, app.gradeId) : null,
      parentName: app.parentName,
      email,
      status: app.status as ApplicationStatus,
      createdAt: app.createdAt.toISOString(),
    })),
  }
}

/** One application in full, with what's needed to admit. */
export async function getApplication(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const row = await ownApplication(ctx, id)
  const db = getDb()
  const ids = [row.applicantId, row.decidedBy, row.studentId].filter((x): x is string => !!x)
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids))
  const who = (uid: string | null) => people.find((p) => p.id === uid)
  const year = await yearById(ctx.org.id, row.yearId)
  const sections = row.gradeId ? sectionsUnder(ctx, row.gradeId) : []
  return {
    id: row.id,
    number: row.number,
    status: row.status as ApplicationStatus,
    message: row.message,
    year: year ? { id: year.id, name: year.name, isCurrent: year.isCurrent } : null,
    grade: row.gradeId ? { id: row.gradeId, name: pathName(ctx, row.gradeId) } : null,
    studentName: row.studentName,
    birthDate: unseal(SEAL, row.birthDate),
    gender: row.gender,
    previousSchool: row.previousSchool,
    parentName: row.parentName,
    relation: row.relation,
    phone: unseal(SEAL, row.phone),
    address: unseal(SEAL, row.address),
    notes: row.notes,
    applicant: { name: who(row.applicantId)?.name ?? null, email: who(row.applicantId)?.email ?? "" },
    decidedBy: who(row.decidedBy)?.name ?? who(row.decidedBy)?.email ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    // The link to the record is only for those who may see student records.
    student:
      row.studentId &&
      (canFor(ctx, "students.view", []) ||
        canFor(ctx, "students.edit", []) ||
        (row.gradeId != null &&
          sectionsUnder(ctx, row.gradeId).some(
            (g) => canFor(ctx, "students.view", [[g]]) || canFor(ctx, "students.edit", [[g]])
          )))
        ? { id: row.studentId }
        : null,
    admittedAs: row.studentId ? true : false,
    createdAt: row.createdAt.toISOString(),
    admit: OPEN_STATUSES.includes(row.status as ApplicationStatus)
      ? {
          sections: sections.map((g) => ({ id: g, name: pathName(ctx, g) })),
          admissionNo: await suggestAdmissionNo(ctx),
          linksParent:
            ctx.modules.has("parents") && row.relation !== "self",
        }
      : null,
  }
}

async function tellApplicant(ctx: OrgContext, row: Row, status: ApplicationStatus, message: string) {
  await notify([row.applicantId], {
    kind: "admission_update",
    title: `${row.studentName}'s application to ${ctx.org.name} is ${STATUS_WORDS[status]}`,
    body: message || undefined,
    href: `/orgs/${ctx.org.slug}/apply`,
    orgId: ctx.org.id,
  })
}

/** Moves an application to reviewing, waitlisted or rejected, telling the applicant. */
export async function setStatus(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof statusSchema>
) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const row = await ownApplication(ctx, id)
  if (!canMoveTo(row.status as ApplicationStatus, input.status))
    throw conflict("bad_move", `An application that's ${row.status} can't become ${input.status}.`)
  await getDb()
    .update(admissionApplications)
    .set({ status: input.status, message: input.message, decidedBy: user.id, decidedAt: new Date() })
    .where(eq(admissionApplications.id, id))
  await writeAudit(
    ctx,
    `admission.${input.status === "reviewing" ? "review" : input.status === "waitlisted" ? "waitlist" : "reject"}`,
    `Marked ${row.number} (${row.studentName}) ${input.status}`,
    { applicationId: id }
  )
  await tellApplicant(ctx, row, input.status, input.message)
  return getApplication(slug, user, id)
}

/**
 * Admits: creates the student (record, account, admission number), enrols them in the
 * section for the application's year, and links the applicant as their parent, at once.
 */
export async function admit(slug: string, user: User, id: string, input: z.infer<typeof admitSchema>) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const row = await ownApplication(ctx, id)
  if (!OPEN_STATUSES.includes(row.status as ApplicationStatus))
    throw conflict("decided", `This application is already ${row.status}.`)
  const year = await yearById(ctx.org.id, row.yearId)
  if (!year) throw conflict("no_year", "The application's academic year no longer exists.")
  if (!row.gradeId || !sectionsUnder(ctx, row.gradeId).includes(input.groupId))
    throw new ApiError(400, "bad_section", "Choose a section of the class applied for.")
  const admissionNo = input.admissionNo || (await suggestAdmissionNo(ctx))
  await admissionFree(ctx, admissionNo)
  const linkParent =
    ctx.modules.has("parents") && row.relation !== "self"
  // A student who applied for themselves is admitted as their own account.
  const [applicant] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, row.applicantId))
  const email = row.relation === "self" ? (applicant?.email ?? "") : input.email
  const studentId = await getDb().transaction(async (tx) => {
    // Lock the application so two admits can't both create a student.
    const [locked] = await tx
      .select({ status: admissionApplications.status })
      .from(admissionApplications)
      .where(eq(admissionApplications.id, id))
      .for("update")
    if (!locked || !OPEN_STATUSES.includes(locked.status as ApplicationStatus))
      throw conflict("decided", "This application was just decided by someone else.")
    const sid = await createInTx(
      tx,
      ctx,
      {
        name: row.studentName,
        email,
        admissionNo,
        gender: row.gender as "" | "female" | "male" | "other",
        birthDate: unseal(SEAL, row.birthDate) ?? "",
        phone: unseal(SEAL, row.phone) ?? "",
        address: unseal(SEAL, row.address) ?? "",
        groupId: input.groupId,
        rollNo: input.rollNo,
      },
      admissionNo,
      year
    )
    if (linkParent)
      await tx
        .insert(guardians)
        .values({
          orgId: ctx.org.id,
          parentId: row.applicantId,
          studentId: sid,
          relation: row.relation === "guardian" ? "" : row.relation,
          createdBy: user.id,
        })
        .onConflictDoNothing()
    await tx
      .update(admissionApplications)
      .set({
        status: "admitted",
        studentId: sid,
        message: input.message,
        decidedBy: user.id,
        decidedAt: new Date(),
      })
      .where(eq(admissionApplications.id, id))
    return sid
  })
  await writeAudit(
    ctx,
    "admission.admit",
    `Admitted ${row.studentName} (${row.number}) as ${admissionNo} to ${pathName(ctx, input.groupId)}, ${year.name}${linkParent ? `, linked to ${row.parentName}` : ""}`,
    { applicationId: id, studentId }
  )
  await tellApplicant(
    ctx,
    row,
    "admitted",
    input.message || `Admission number ${admissionNo}, ${pathName(ctx, input.groupId)}, ${year.name}.`
  )
  return { studentId, admissionNo }
}

/* ---------- settings ---------- */

export async function admissionSettings(slug: string, user: User) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const years = await getDb()
    .select({ id: academicYears.id, name: academicYears.name, isCurrent: academicYears.isCurrent })
    .from(academicYears)
    .where(eq(academicYears.orgId, ctx.org.id))
    .orderBy(desc(academicYears.startsOn))
  return {
    settings: settingsOf(ctx),
    years,
    grades: ctx.groups
      .filter((g) => !g.parentId)
      .map((g) => ({ id: g.id, name: g.name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    applyUrl: `/orgs/${ctx.org.slug}/apply`,
  }
}

export async function saveAdmissionSettings(
  slug: string,
  user: User,
  input: z.infer<typeof settingsSchema>
) {
  const ctx = await context(slug, user)
  needManage(ctx)
  if (input.yearId && !(await yearById(ctx.org.id, input.yearId))) throw notFound("Year not found")
  if (input.open && !input.yearId)
    throw new ApiError(400, "no_year", "Choose the academic year applications are for.")
  const top = new Set(ctx.groups.filter((g) => !g.parentId).map((g) => g.id))
  if (input.gradeIds.some((g) => !top.has(g)))
    throw new ApiError(400, "bad_grade", "Choose classes at the top level, like grades.")
  const settings = (ctx.org.moduleSettings ?? {}) as Record<string, unknown>
  await getDb()
    .update(organizations)
    .set({ moduleSettings: { ...settings, admissions: input } })
    .where(eq(organizations.id, ctx.org.id))
  await writeAudit(
    ctx,
    "admission.settings",
    `${input.open ? "Opened" : "Closed"} admissions${input.gradeIds.length ? ` for ${input.gradeIds.length} classes` : ""}`
  )
  return admissionSettings(slug, user)
}

/** How many applications wait for this person's first look (for the sidebar). Never throws. */
export async function newApplications(ctx: OrgContext) {
  try {
    if (!ctx.modules.has("admissions") || !manages(ctx)) return 0
    const [row] = await getDb()
      .select({ n: count() })
      .from(admissionApplications)
      .where(
        and(
          eq(admissionApplications.orgId, ctx.org.id),
          eq(admissionApplications.status, "submitted")
        )
      )
    return Number(row?.n ?? 0)
  } catch {
    return 0
  }
}
