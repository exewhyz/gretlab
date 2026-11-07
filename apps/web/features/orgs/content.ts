import { getDb, notes, problems, sql, type User } from "@workspace/db"

import {
  addLineComment,
  deleteAssignment,
  deleteLineComment,
  releaseFeedback,
  extendStudentSitting,
  setRubricMarks,
  listAssignments,
  getAssignmentForStaff,
  getGradebook,
  gradebookCsv,
  listAssignmentsForStaff,
  saveAssignment,
  studentAttempts,
} from "@/features/assignments/server"
import {
  deleteContest,
  listContests,
  getContestForStaff,
  listOwnedContests,
  saveContest,
} from "@/features/contests/server"
import type {
  AssignmentInput,
  ContestInput,
  ProblemInput,
} from "@/features/problems/schemas"
import {
  addNote,
  buildDetail,
  deleteNote,
  deleteProblem,
  getProblemForStaff,
  listNotes,
  listProblemsForStaff,
  saveProblem,
  type ProblemSummary,
} from "@/features/problems/server"
import { ApiError } from "@/lib/api/route"

import { accessTo, narrowLanguages, viewpoint } from "./access"

import {
  canAnywhere,
  canFor,
  checkAudience,
  groupsFor,
  needFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "./server"

/*
 * An organization's contests, assignments, problems and notices. Each function checks the
 * permission for the groups the content is for, then calls the shared logic with the
 * organization as owner, so every query is limited to this organization's rows.
 */

const { and, asc, eq } = sql

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

function needAnywhere(
  ctx: OrgContext,
  ...permissions: Parameters<typeof canAnywhere>[1][]
) {
  if (!permissions.some((p) => canAnywhere(ctx, p))) {
    throw forbidden("You don't have permission to do that.")
  }
}

/* ---------- contests ---------- */

export async function orgContests(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "contests.manage")
  return (await listOwnedContests(ctx.org.id)).filter((c) =>
    canFor(ctx, "contests.manage", c.audience)
  )
}

export async function orgContest(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  const contest = await getContestForStaff(id, ctx.org.id)
  needFor(ctx, "contests.manage", contest.audience)
  return contest
}

export async function saveOrgContest(
  slug: string,
  user: User,
  id: string | null,
  input: ContestInput
) {
  const ctx = await orgContext(slug, user)
  checkAudience(ctx, input.audience)
  // Both who it was for and who it will be for must be within reach.
  if (id)
    needFor(
      ctx,
      "contests.manage",
      (await getContestForStaff(id, ctx.org.id)).audience
    )
  needFor(ctx, "contests.manage", input.audience)
  const contest = await saveContest(id, input, ctx.org.id)
  await writeAudit(
    ctx,
    id ? "contest.update" : "contest.create",
    `${id ? "Changed" : "Created"} contest ${input.title}`
  )
  return contest
}

export async function deleteOrgContest(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  const contest = await getContestForStaff(id, ctx.org.id)
  needFor(ctx, "contests.manage", contest.audience)
  await deleteContest(id, ctx.org.id)
  await writeAudit(ctx, "contest.delete", `Deleted contest ${contest.title}`)
}

/* ---------- assignments ---------- */

export async function orgAssignments(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "assignments.manage", "gradebook.view")
  return (await listAssignmentsForStaff(ctx.org.id)).filter(
    (a) =>
      canFor(ctx, "assignments.manage", a.audience) ||
      canAnywhere(ctx, "gradebook.view")
  )
}

export async function orgAssignment(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  const assignment = await getAssignmentForStaff(id, ctx.org.id)
  needFor(ctx, "assignments.manage", assignment.audience)
  return assignment
}

export async function saveOrgAssignment(
  slug: string,
  user: User,
  id: string | null,
  input: AssignmentInput
) {
  const ctx = await orgContext(slug, user)
  checkAudience(ctx, input.audience)
  if (id) {
    needFor(
      ctx,
      "assignments.manage",
      (await getAssignmentForStaff(id, ctx.org.id)).audience
    )
  }
  needFor(ctx, "assignments.manage", input.audience)
  const assignment = await saveAssignment(id, input, ctx.org.id)
  await writeAudit(
    ctx,
    id ? "assignment.update" : "assignment.create",
    `${id ? "Changed" : "Created"} assignment ${input.title}`
  )
  return assignment
}

export async function deleteOrgAssignment(
  slug: string,
  user: User,
  id: string
) {
  const ctx = await orgContext(slug, user)
  const assignment = await getAssignmentForStaff(id, ctx.org.id)
  needFor(ctx, "assignments.manage", assignment.audience)
  await deleteAssignment(id, ctx.org.id)
  await writeAudit(
    ctx,
    "assignment.delete",
    `Deleted assignment ${assignment.title}`
  )
}

/** Grades of the students this person may see: everyone, or those in their groups. */
export async function orgGradebook(
  slug: string,
  user: User,
  id: string,
  csv: boolean
) {
  const ctx = await orgContext(slug, user)
  const permission = csv ? "gradebook.export" : "gradebook.view"
  needAnywhere(ctx, permission)
  const scope = groupsFor(ctx, permission)
  if (csv) {
    await writeAudit(ctx, "gradebook.export", "Downloaded a gradebook", {
      assignment: id,
    })
    return gradebookCsv(id, ctx.org.id, scope)
  }
  return getGradebook(id, ctx.org.id, scope)
}

/* ---------- problems ---------- */

/** With `picker`, also everyone's published problems, for choosing contest problems. */
export async function orgProblems(slug: string, user: User, picker: boolean) {
  const ctx = await orgContext(slug, user)
  if (picker)
    needAnywhere(
      ctx,
      "problems.manage",
      "contests.manage",
      "assignments.manage"
    )
  else needAnywhere(ctx, "problems.manage")
  return listProblemsForStaff(ctx.org.id, picker)
}

export async function orgProblem(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "problems.manage")
  return getProblemForStaff(id, ctx.org.id)
}

export async function saveOrgProblem(
  slug: string,
  user: User,
  id: string | null,
  input: ProblemInput
) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "problems.manage")
  const problem = await saveProblem(id, input, ctx.org.id)
  await writeAudit(
    ctx,
    id ? "problem.update" : "problem.create",
    `${id ? "Changed" : "Created"} problem ${input.title}`
  )
  return problem
}

export async function deleteOrgProblem(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "problems.manage")
  await deleteProblem(id, ctx.org.id)
  await writeAudit(ctx, "problem.delete", "Deleted a problem")
}

/* ---------- notices ---------- */

export async function orgNotices(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "notices.manage")
  return listNotes(ctx.org.id)
}

export async function addOrgNotice(slug: string, user: User, text: string) {
  const ctx = await orgContext(slug, user)
  // A notice here is for the whole organization; class notices go from the class page.
  needFor(ctx, "notices.manage", [])
  const note = await addNote(text, null, ctx.org.id)
  await writeAudit(ctx, "notice.create", "Posted a notice")
  return note
}

export async function deleteOrgNotice(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "notices.manage")
  // Only for the people it's for: a class's teacher can remove that class's notices.
  const [note] = await getDb()
    .select({ audience: notes.audience })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.orgId, ctx.org.id)))
  if (note) needFor(ctx, "notices.manage", note.audience)
  await deleteNote(id, ctx.org.id)
  await writeAudit(ctx, "notice.delete", "Removed a notice")
}

/* ---------- what members see ---------- */

/** Notices, assignments and contests this member has from the organization. */
export async function orgFeed(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (ctx.membership?.status !== "active" && !ctx.platformAdmin) {
    throw new ApiError(404, "not_found", "Join to see this.")
  }
  const [allNotices, assignments, contests, vp] = await Promise.all([
    listNotes(ctx.org.id),
    // Either feature may be switched off; then that list is just empty.
    listAssignments(user).catch(() => []),
    listContests(user),
    viewpoint(user),
  ])
  // A class's notice reaches only that class.
  const notices = allNotices.filter(
    (n) =>
      accessTo(
        vp,
        { orgId: ctx.org.id, audience: n.audience },
        "notices.manage"
      ) !== "none"
  )
  return {
    notices: notices.map(({ id, text, createdAt }) => ({
      id,
      text,
      createdAt,
    })),
    assignments: assignments.filter((a) => a.org?.slug === slug),
    contests: contests
      .filter((c) => c.org?.slug === slug)
      .map(({ slug: contestSlug, title, phase, startsAt, endsAt }) => ({
        slug: contestSlug,
        title,
        phase,
        startsAt,
        endsAt,
      })),
  }
}

/* ---------- members' practice ---------- */

/** The organization's published problems, including members-only ones, for its members. */
export async function orgPractice(
  slug: string,
  user: User,
  problemSlug: string | null
) {
  const ctx = await orgContext(slug, user)
  if (ctx.membership?.status !== "active" && !ctx.platformAdmin) {
    throw new ApiError(404, "not_found", "Join to see this.")
  }
  const rows = await getDb()
    .select()
    .from(problems)
    .where(and(eq(problems.orgId, ctx.org.id), eq(problems.published, true)))
    .orderBy(asc(problems.position), asc(problems.title))
  const summaries: ProblemSummary[] = rows.map((p, index) => ({
    id: p.slug,
    title: p.title,
    level: p.level,
    unit: ctx.org.name,
    unitNo: 0,
    no: index + 1,
    label: `${index + 1}`,
  }))
  if (!problemSlug) {
    return {
      org: ctx.org.name,
      summaries: summaries.map((s, i) => ({
        ...s,
        membersOnly: rows[i]!.membersOnly,
      })),
    }
  }
  const index = rows.findIndex((p) => p.slug === problemSlug)
  if (index < 0) throw new ApiError(404, "not_found", "Problem not found")
  const detail = await buildDetail(rows[index]!, summaries[index]!)
  return {
    org: ctx.org.name,
    summaries,
    problem: rows[index]!.membersOnly
      ? {
          ...detail,
          allowedLanguages: narrowLanguages(
            detail.allowedLanguages,
            ctx.org.languages
          ),
        }
      : detail,
  }
}

/** A student's code for one assignment problem, for teachers who see that student's grades. */
export async function orgStudentAttempts(
  slug: string,
  user: User,
  id: string,
  email: string,
  problemId: string,
  withHistory = false
) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "gradebook.view")
  return studentAttempts(
    id,
    ctx.org.id,
    groupsFor(ctx, "gradebook.view"),
    email,
    problemId,
    withHistory
  )
}

/* ---------- feedback: rubric marks, line comments, release ---------- */

/** Giving feedback needs managing assignments, for students whose grades this person sees. */
async function feedbackContext(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "assignments.manage")
  needAnywhere(ctx, "gradebook.view")
  return { ctx, scope: groupsFor(ctx, "gradebook.view") }
}

export async function orgSetRubricMarks(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof setRubricMarks>[3]
) {
  const { ctx, scope } = await feedbackContext(slug, user)
  return setRubricMarks(id, ctx.org.id, scope, input, user.id)
}

export async function orgAddLineComment(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof addLineComment>[3]
) {
  const { ctx, scope } = await feedbackContext(slug, user)
  return addLineComment(id, ctx.org.id, scope, input, user.id)
}

export async function orgDeleteLineComment(
  slug: string,
  user: User,
  id: string,
  commentId: string
) {
  const { ctx } = await feedbackContext(slug, user)
  await deleteLineComment(id, ctx.org.id, commentId)
}

export async function orgExtendSitting(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof extendStudentSitting>[3]
) {
  const { ctx, scope } = await feedbackContext(slug, user)
  const sitting = await extendStudentSitting(id, ctx.org.id, scope, input)
  await writeAudit(ctx, "assignment.exam_time", "Gave a student more exam time", {
    assignment: id,
    student: input.student,
    minutes: input.minutes,
  })
  return sitting
}

export async function orgReleaseFeedback(slug: string, user: User, id: string) {
  const { ctx } = await feedbackContext(slug, user)
  await releaseFeedback(id, ctx.org.id)
  await writeAudit(
    ctx,
    "assignment.feedback",
    "Released an assignment's feedback",
    {
      assignment: id,
    }
  )
}
