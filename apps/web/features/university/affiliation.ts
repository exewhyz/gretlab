import {
  getDb,
  orgAffiliations,
  organizations,
  sql,
  users,
  type User,
} from "@workspace/db"
import {
  affiliationNext,
  collegeCodeProblem,
  normalizeCollegeCode,
  type AffiliationAction,
} from "@workspace/judge"
import { z } from "zod"

import { writeEntry } from "@/features/audit/server"
import { notify } from "@/features/notifications/server"
import {
  canFor,
  membersWhoCan,
  orgContext,
  type OrgContext,
} from "@/features/orgs/server"
import { likeTerm, paged, readPage } from "@/lib/api/paging"
import { ApiError, notFound } from "@/lib/api/route"
import { orgPages } from "@/lib/paths"

/*
 * Affiliation: a college asks to affiliate to a university (by its address); the university
 * approves it with a college code, or refuses; an active affiliation can end (either side). At
 * most one asked-for or active per college (a unique index). Every step goes in both
 * organizations' activity logs, and the other side is told. Rules in
 * packages/judge/src/university.ts.
 */

const { and, desc, eq, ilike, inArray, or, sql: raw } = { ...sql, sql: sql.sql }

export const requestSchema = z.object({
  /** The university's address (/orgs/<slug>). */
  university: z.string().trim().min(2).max(60),
  note: z.string().trim().max(500).default(""),
})

export const decideSchema = z.object({
  action: z.enum(["approve", "refuse", "end"]),
  /** Approve only: the college's code at the university. */
  code: z.string().max(20).optional(),
  note: z.string().trim().max(500).default(""),
})

const forbidden = (what: string) =>
  new ApiError(403, "forbidden", `${what} isn't part of your role.`)

/** A college's side: organization-wide "Change settings". */
function needCollegeSide(ctx: OrgContext) {
  if (ctx.org.type !== "college")
    throw notFound("Only a college affiliates to a university.")
  if (!canFor(ctx, "org.settings.manage", []))
    throw forbidden("Affiliating to a university")
}

/** The university's side: the module on, and a permission across the organization. */
export function needUniversity(
  ctx: OrgContext,
  permission:
    | "university.colleges"
    | "university.share"
    | "university.view"
    | "university.syllabus"
    | "university.registrations"
    | "university.exams"
) {
  if (ctx.org.type !== "university" || !ctx.modules.has("affiliation"))
    throw notFound("Affiliated colleges aren't switched on here.")
  if (!canFor(ctx, permission, []))
    throw forbidden("Running affiliated colleges")
}

/** A college's affiliations, newest first: the live one (if any) and what came before. */
async function affiliationsOf(collegeId: string) {
  return getDb()
    .select({
      id: orgAffiliations.id,
      status: orgAffiliations.status,
      collegeCode: orgAffiliations.collegeCode,
      note: orgAffiliations.note,
      requestedAt: orgAffiliations.requestedAt,
      decidedAt: orgAffiliations.decidedAt,
      university: {
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      },
    })
    .from(orgAffiliations)
    .innerJoin(
      organizations,
      eq(organizations.id, orgAffiliations.universityId)
    )
    .where(eq(orgAffiliations.collegeId, collegeId))
    .orderBy(desc(orgAffiliations.requestedAt))
}

/** The college's Manage › University: its affiliation now and before. */
export async function collegeAffiliation(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needCollegeSide(ctx)
  const all = await affiliationsOf(ctx.org.id)
  const live =
    all.find((a) => a.status === "requested" || a.status === "active") ?? null
  return { current: live, history: all.filter((a) => a !== live) }
}

/** Logs a step in both organizations' activity logs, and tells the other side. */
async function record(
  user: User,
  college: { id: string; name: string; slug: string },
  university: { id: string; name: string; slug: string },
  action: string,
  summary: string,
  tell: "college" | "university"
) {
  const db = getDb()
  const actor = { id: user.id, name: user.name, email: user.email }
  await writeEntry(db, { orgId: college.id, actor, action, summary })
  await writeEntry(db, { orgId: university.id, actor, action, summary })
  const to = tell === "university" ? university : college
  await notify(
    await membersWhoCan(
      to.id,
      tell === "university" ? "university.colleges" : "org.settings.manage"
    ),
    {
      kind: "affiliation",
      title: summary,
      href:
        tell === "university"
          ? orgPages(university.slug).manage("/colleges")
          : orgPages(college.slug).manage("/university"),
      orgId: to.id,
    }
  )
}

/** A college asks to affiliate to a university. A protected action. */
export async function requestAffiliation(
  slug: string,
  user: User,
  input: z.infer<typeof requestSchema>
) {
  const ctx = await orgContext(slug, user)
  needCollegeSide(ctx)
  const db = getDb()
  const [uni] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, input.university.toLowerCase()))
  if (!uni || uni.type !== "university" || !uni.active)
    throw new ApiError(
      400,
      "not_a_university",
      "There's no university at that address."
    )
  const all = await affiliationsOf(ctx.org.id)
  const live = all.find(
    (a) => a.status === "requested" || a.status === "active"
  )
  const next = affiliationNext(live?.status ?? null, "request")
  if (!next.ok) throw new ApiError(409, "affiliation_exists", next.problem)
  const [row] = await db
    .insert(orgAffiliations)
    .values({
      universityId: uni.id,
      collegeId: ctx.org.id,
      status: "requested",
      note: input.note,
      requestedBy: user.id,
    })
    .returning({ id: orgAffiliations.id })
    .catch((error: { code?: string; cause?: { code?: string } }) => {
      // Two requests at once: the unique index lets one through.
      if ((error.cause?.code ?? error.code) === "23505")
        throw new ApiError(
          409,
          "affiliation_exists",
          "This college has already asked to affiliate."
        )
      throw error
    })
  await record(
    user,
    ctx.org,
    uni,
    "university.affiliation",
    `${ctx.org.name} asked to affiliate to ${uni.name}`,
    "university"
  )
  return row!
}

/** The college withdraws its request, or leaves its university. A protected action. */
export async function leaveAffiliation(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needCollegeSide(ctx)
  const all = await affiliationsOf(ctx.org.id)
  const live = all.find(
    (a) => a.status === "requested" || a.status === "active"
  )
  if (!live) throw notFound("This college isn't affiliated or asking.")
  const action: AffiliationAction =
    live.status === "requested" ? "withdraw" : "end"
  const next = affiliationNext(live.status, action)
  if (!next.ok) throw new ApiError(409, "bad_step", next.problem)
  await getDb()
    .update(orgAffiliations)
    .set({ status: next.status, decidedBy: user.id, decidedAt: new Date() })
    .where(eq(orgAffiliations.id, live.id))
  await record(
    user,
    ctx.org,
    live.university,
    "university.affiliation",
    action === "withdraw"
      ? `${ctx.org.name} withdrew its request to affiliate to ${live.university.name}`
      : `${ctx.org.name} left ${live.university.name}`,
    "university"
  )
}

/** The university's Manage › Colleges: requests first, then its colleges, paged and searched. */
export async function universityColleges(
  slug: string,
  user: User,
  query: URLSearchParams
) {
  const ctx = await orgContext(slug, user)
  needUniversityAny(ctx)
  const page = readPage(query)
  const status = query.get("status")
  const statuses =
    status === "requested" || status === "active"
      ? [status]
      : ["requested", "active"]
  const term = page.q ? likeTerm(page.q) : null
  const where = and(
    eq(orgAffiliations.universityId, ctx.org.id),
    inArray(orgAffiliations.status, statuses),
    term
      ? or(
          ilike(organizations.name, term),
          ilike(orgAffiliations.collegeCode, term)
        )
      : undefined
  )
  const db = getDb()
  const result = await paged({
    page: page.page ?? 1,
    perPage: page.perPage ?? 50,
    count: async () =>
      Number(
        (
          await db
            .select({ n: raw<number>`count(*)` })
            .from(orgAffiliations)
            .innerJoin(
              organizations,
              eq(organizations.id, orgAffiliations.collegeId)
            )
            .where(where)
        )[0]?.n ?? 0
      ),
    rows: (limit, offset) =>
      db
        .select({
          id: orgAffiliations.id,
          status: orgAffiliations.status,
          collegeCode: orgAffiliations.collegeCode,
          note: orgAffiliations.note,
          requestedAt: orgAffiliations.requestedAt,
          decidedAt: orgAffiliations.decidedAt,
          college: {
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
          },
          requestedBy: users.name,
        })
        .from(orgAffiliations)
        .innerJoin(
          organizations,
          eq(organizations.id, orgAffiliations.collegeId)
        )
        .leftJoin(users, eq(users.id, orgAffiliations.requestedBy))
        .where(where)
        .orderBy(
          raw`case when ${orgAffiliations.status} = 'requested' then 0 else 1 end`,
          organizations.name
        )
        .limit(limit)
        .offset(offset),
  })
  const [counts] = await db
    .select({
      requested:
        raw<number>`count(*) filter (where ${orgAffiliations.status} = 'requested')`.mapWith(
          Number
        ),
      active:
        raw<number>`count(*) filter (where ${orgAffiliations.status} = 'active')`.mapWith(
          Number
        ),
    })
    .from(orgAffiliations)
    .where(eq(orgAffiliations.universityId, ctx.org.id))
  return {
    ...result,
    counts: counts ?? { requested: 0, active: 0 },
    can: { decide: canFor(ctx, "university.colleges", []) },
  }
}

/** Either university permission that opens the colleges list. */
function needUniversityAny(ctx: OrgContext) {
  if (ctx.org.type !== "university" || !ctx.modules.has("affiliation"))
    throw notFound("Affiliated colleges aren't switched on here.")
  if (
    !canFor(ctx, "university.colleges", []) &&
    !canFor(ctx, "university.view", [])
  )
    throw forbidden("Affiliated colleges")
}

/** The university approves (with a college code), refuses or ends an affiliation. A protected action. */
export async function decideAffiliation(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof decideSchema>
) {
  const ctx = await orgContext(slug, user)
  needUniversity(ctx, "university.colleges")
  const db = getDb()
  const [row] = await db
    .select({
      a: orgAffiliations,
      college: {
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      },
    })
    .from(orgAffiliations)
    .innerJoin(organizations, eq(organizations.id, orgAffiliations.collegeId))
    .where(
      and(
        eq(orgAffiliations.id, id),
        eq(orgAffiliations.universityId, ctx.org.id)
      )
    )
  if (!row) throw notFound("No such college.")
  const next = affiliationNext(row.a.status, input.action)
  if (!next.ok) throw new ApiError(409, "bad_step", next.problem)
  let code: string | null = row.a.collegeCode
  if (input.action === "approve") {
    code = normalizeCollegeCode(input.code ?? "")
    const problem = collegeCodeProblem(code)
    if (problem) throw new ApiError(400, "bad_code", problem)
  }
  try {
    await db
      .update(orgAffiliations)
      .set({
        status: next.status,
        collegeCode: code,
        note: input.note || row.a.note,
        decidedBy: user.id,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(orgAffiliations.id, id),
          eq(orgAffiliations.status, row.a.status)
        )
      )
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } }
    if ((e.cause?.code ?? e.code) === "23505")
      throw new ApiError(
        409,
        "code_taken",
        "Another college already has that code."
      )
    throw error
  }
  const words = {
    approve: `${ctx.org.name} approved ${row.college.name}'s affiliation, as ${code}`,
    refuse: `${ctx.org.name} refused ${row.college.name}'s request to affiliate`,
    end: `${ctx.org.name} ended ${row.college.name}'s affiliation`,
  }[input.action]
  await record(
    user,
    row.college,
    ctx.org,
    "university.affiliation",
    words,
    "college"
  )
}

/**
 * The university a college is affiliated to now, or null. The one test every other university
 * route uses before reaching into a college: while it's active, and only then.
 */
export async function activeUniversityOf(collegeId: string) {
  const [row] = await getDb()
    .select({
      universityId: orgAffiliations.universityId,
      code: orgAffiliations.collegeCode,
    })
    .from(orgAffiliations)
    .where(
      and(
        eq(orgAffiliations.collegeId, collegeId),
        eq(orgAffiliations.status, "active")
      )
    )
  return row ?? null
}

/** The colleges affiliated to a university now (for the routes that reach into them). */
export async function activeCollegesOf(universityId: string) {
  return getDb()
    .select({
      collegeId: orgAffiliations.collegeId,
      code: orgAffiliations.collegeCode,
      name: organizations.name,
      slug: organizations.slug,
    })
    .from(orgAffiliations)
    .innerJoin(organizations, eq(organizations.id, orgAffiliations.collegeId))
    .where(
      and(
        eq(orgAffiliations.universityId, universityId),
        eq(orgAffiliations.status, "active")
      )
    )
    .orderBy(organizations.name)
}
