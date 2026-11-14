import { assignments, getDb, notes, problems, sql, type User } from "@workspace/db"
import type { Permission } from "@workspace/judge"
import {
  deleteQuestion,
  getQuestionForStaff,
  importQuestions,
  listQuestionsForStaff,
  saveQuestion,
} from "@/features/questions/server"

import {
  addLineComment,
  deleteAssignment,
  deleteLineComment,
  releaseFeedback,
  extendStudentSitting,
  forgetExamAddresses,
  rejudgeSystemErrors,
  setQuizMarks,
  studentQuiz,
  setExtension,
  removeExtension,
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
  importProblems,
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
  const contestAction = id ? "contests.edit" : "contests.create"
  if (id)
    needFor(
      ctx,
      contestAction,
      (await getContestForStaff(id, ctx.org.id)).audience
    )
  needFor(ctx, contestAction, input.audience)
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
  needFor(ctx, "contests.delete", contest.audience)
  await deleteContest(id, ctx.org.id)
  await writeAudit(ctx, "contest.delete", `Deleted contest ${contest.title}`)
}

/* ---------- assignments ---------- */

export async function orgAssignments(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "assignments.manage", "gradebook.view")
  return (await listAssignmentsForStaff(ctx.org.id))
    .filter(
      (a) =>
        canFor(ctx, "assignments.manage", a.audience) ||
        canAnywhere(ctx, "gradebook.view")
    )
    .map((a) => ({
      ...a,
      // Whether its editor opens for them; otherwise the list links to its gradebook.
      canEdit: canFor(ctx, "assignments.edit", a.audience),
    }))
}

export async function orgAssignment(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  const assignment = await getAssignmentForStaff(id, ctx.org.id)
  needFor(ctx, "assignments.edit", assignment.audience)
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
  const existing = id ? await getAssignmentForStaff(id, ctx.org.id) : null
  const action = id ? "assignments.edit" : "assignments.create"
  if (existing) needFor(ctx, action, existing.audience)
  needFor(ctx, action, input.audience)
  // Publishing (or unpublishing) is its own action, so a role may draft but not release.
  if (input.published !== (existing?.published ?? false)) {
    needFor(ctx, "assignments.publish", input.audience)
    if (existing) needFor(ctx, "assignments.publish", existing.audience)
  }
  const assignment = await saveAssignment(id, input, ctx.org.id, { by: user })
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
  needFor(ctx, "assignments.delete", assignment.audience)
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
  const book = await getGradebook(id, ctx.org.id, scope)
  const [row] = await getDb()
    .select({ audience: assignments.audience })
    .from(assignments)
    .where(
      sql.and(sql.eq(assignments.id, id), sql.eq(assignments.orgId, ctx.org.id))
    )
  const audience = row?.audience ?? []
  const viewsAll = canFor(ctx, "gradebook.view", audience)
  return {
    ...book,
    /** What the page offers them: each button only where its action would be allowed. */
    can: {
      edit: canFor(ctx, "assignments.edit", audience),
      rejudge: canAnywhere(ctx, "assignments.grade"),
      release: canAnywhere(ctx, "assignments.grade"),
      forgetAddresses: canAnywhere(ctx, "assignments.manage"),
      export: canAnywhere(ctx, "gradebook.export"),
      peer: viewsAll,
      sendGrades: viewsAll && canFor(ctx, "assignments.manage", audience),
    },
  }
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
  return listProblemsForStaff(ctx.org.id, picker, user.id)
}

export async function orgProblem(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "problems.manage")
  return getProblemForStaff(id, ctx.org.id)
}

export async function orgQuestions(slug: string, user: User, picker: boolean) {
  const ctx = await orgContext(slug, user)
  // Picking needs the right to set work; the bank itself, to write problems.
  if (picker)
    needAnywhere(
      ctx,
      "assignments.manage",
      "contests.manage",
      "problems.manage"
    )
  else needAnywhere(ctx, "problems.manage")
  return listQuestionsForStaff(ctx.org.id, picker, user.id)
}

export async function orgQuestion(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "problems.manage")
  return getQuestionForStaff(id, ctx.org.id)
}

export async function saveOrgQuestion(
  slug: string,
  user: User,
  id: string | null,
  input: Parameters<typeof saveQuestion>[1]
) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, id ? "problems.edit" : "problems.create")
  const saved = await saveQuestion(id, input, ctx.org.id)
  await writeAudit(
    ctx,
    id ? "question.update" : "question.create",
    `${id ? "Changed" : "Created"} question ${input.title}`
  )
  return saved
}

export async function deleteOrgQuestion(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "problems.delete")
  await deleteQuestion(id, ctx.org.id)
  await writeAudit(ctx, "question.delete", "Deleted a question", {
    question: id,
  })
}

export async function orgImportQuestions(
  slug: string,
  user: User,
  input: { file: unknown; published: boolean }
) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "problems.create")
  const result = await importQuestions(ctx.org.id, input.file, input.published)
  await writeAudit(
    ctx,
    "question.import",
    `Imported ${result.created.length} questions`
  )
  return result
}

export async function orgImportProblems(
  slug: string,
  user: User,
  input: { file: unknown; listed: boolean; published: boolean }
) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "problems.create")
  const result = await importProblems(ctx.org.id, input.file, input)
  await writeAudit(
    ctx,
    "problem.import",
    `Imported ${result.created.length} problems`,
    { problems: result.created.map((p) => p.slug) }
  )
  return result
}

export async function saveOrgProblem(
  slug: string,
  user: User,
  id: string | null,
  input: ProblemInput
) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, id ? "problems.edit" : "problems.create")
  if (input.published) needAnywhere(ctx, "problems.publish")
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
  needAnywhere(ctx, "problems.delete")
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
  needFor(ctx, "notices.create", [])
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
  if (note) needFor(ctx, "notices.delete", note.audience)
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
async function feedbackContext(
  slug: string,
  user: User,
  // The action being done: grading, extending, or (default) general exam management.
  action: Permission = "assignments.manage"
) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, action)
  needAnywhere(ctx, "gradebook.view")
  return { ctx, scope: groupsFor(ctx, "gradebook.view") }
}

export async function orgSetRubricMarks(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof setRubricMarks>[3]
) {
  const { ctx, scope } = await feedbackContext(slug, user, "assignments.grade")
  return setRubricMarks(id, ctx.org.id, scope, input, user.id)
}

export async function orgAddLineComment(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof addLineComment>[3]
) {
  const { ctx, scope } = await feedbackContext(slug, user, "assignments.grade")
  return addLineComment(id, ctx.org.id, scope, input, user.id)
}

export async function orgDeleteLineComment(
  slug: string,
  user: User,
  id: string,
  commentId: string
) {
  const { ctx } = await feedbackContext(slug, user, "assignments.grade")
  await deleteLineComment(id, ctx.org.id, commentId)
}

export async function orgExtendSitting(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof extendStudentSitting>[3]
) {
  const { ctx, scope } = await feedbackContext(slug, user, "assignments.extend")
  const sitting = await extendStudentSitting(id, ctx.org.id, scope, input)
  await writeAudit(
    ctx,
    "assignment.exam_time",
    "Gave a student more exam time",
    {
      assignment: id,
      student: input.student,
      minutes: input.minutes,
    }
  )
  return sitting
}

export async function orgSetExtension(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof setExtension>[3]
) {
  const { ctx, scope } = await feedbackContext(slug, user, "assignments.extend")
  const result = await setExtension(id, ctx.org.id, scope, input, user.id)
  await writeAudit(
    ctx,
    "assignment.extension",
    `Extended an assignment for ${input.student}`,
    {
      assignment: id,
      student: input.student,
      dueAt: input.dueAt.toISOString(),
      problems: input.problemIds.length,
    }
  )
  return result
}

export async function orgRemoveExtension(
  slug: string,
  user: User,
  id: string,
  email: string
) {
  const { ctx, scope } = await feedbackContext(slug, user, "assignments.extend")
  await removeExtension(id, ctx.org.id, scope, email)
  await writeAudit(
    ctx,
    "assignment.extension_removed",
    `Removed ${email}'s extension`,
    {
      assignment: id,
    }
  )
}

export async function orgStudentQuiz(
  slug: string,
  user: User,
  id: string,
  email: string
) {
  const ctx = await orgContext(slug, user)
  needAnywhere(ctx, "gradebook.view")
  return studentQuiz(id, ctx.org.id, groupsFor(ctx, "gradebook.view"), email)
}

export async function orgSetQuizMarks(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof setQuizMarks>[3]
) {
  const { ctx, scope } = await feedbackContext(slug, user, "assignments.grade")
  const result = await setQuizMarks(id, ctx.org.id, scope, input)
  await writeAudit(
    ctx,
    "assignment.quiz_marks",
    `Marked ${input.student}'s answers`,
    {
      assignment: id,
    }
  )
  return result
}

export async function orgRejudgeSystemErrors(
  slug: string,
  user: User,
  id: string
) {
  const { ctx, scope } = await feedbackContext(slug, user, "assignments.grade")
  const result = await rejudgeSystemErrors(id, ctx.org.id, scope)
  await writeAudit(
    ctx,
    "assignment.rejudge",
    "Re-judged an assignment's system errors",
    {
      assignment: id,
      queued: result.queued,
    }
  )
  return result
}

export async function orgForgetExamAddresses(
  slug: string,
  user: User,
  id: string
) {
  const { ctx } = await feedbackContext(slug, user)
  await forgetExamAddresses(id, ctx.org.id)
  await writeAudit(
    ctx,
    "assignment.exam_addresses",
    "Forgot an exam's network addresses",
    {
      assignment: id,
    }
  )
}

export async function orgReleaseFeedback(slug: string, user: User, id: string) {
  const { ctx } = await feedbackContext(slug, user, "assignments.grade")
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
