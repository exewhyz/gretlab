import {
  courseClasses,
  courses,
  getDb,
  practiceAnswers,
  questions,
  sql,
  submissions,
  type User,
} from "@workspace/db"
import { markQuestion, releaseModules } from "@workspace/judge"

import { today } from "@/features/catalog/server"
import { classContext, studentsIn } from "@/features/classes/server"
import { usableBy, usableIds } from "@/features/library/sharing"
import { canFor, groupChain, needFor, writeAudit } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

import { outlineOf, type OutlineItem } from "./server"

/*
 * Courses in a class. A course given to a group reaches that group's classes and every
 * group inside it. Teachers see the whole outline and how far students are; students see
 * modules as they open (features/courses/server.ts has the rules' data, packages/judge
 * course.ts the release rules) and practise in them. Practice is never graded.
 */

const { and, eq, inArray, sql: raw } = sql

/** Tries after which a practice question shows its answer even when still wrong. */
const SHOW_AFTER_TRIES = 3

async function finished(userIds: string[], items: OutlineItem[]) {
  const problemIds = items.filter((i) => i.kind === "problem").map((i) => i.id)
  const questionIds = items.filter((i) => i.kind === "question").map((i) => i.id)
  const db = getDb()
  const [solved, answered] = await Promise.all([
    problemIds.length && userIds.length
      ? db
          .selectDistinct({ userId: submissions.userId, id: submissions.problemId })
          .from(submissions)
          .where(
            and(
              inArray(submissions.userId, userIds),
              inArray(submissions.problemId, problemIds),
              eq(submissions.kind, "submit"),
              eq(submissions.verdict, "AC")
            )
          )
      : [],
    questionIds.length && userIds.length
      ? db
          .select({
            userId: practiceAnswers.userId,
            id: practiceAnswers.questionId,
            answer: practiceAnswers.answer,
            correct: practiceAnswers.correct,
            tries: practiceAnswers.tries,
          })
          .from(practiceAnswers)
          .where(
            and(
              inArray(practiceAnswers.userId, userIds),
              inArray(practiceAnswers.questionId, questionIds)
            )
          )
      : [],
  ])
  const done = new Map<string, Set<string>>()
  for (const r of [...solved, ...answered.filter((a) => a.correct)]) {
    if (!r.userId) continue
    const set = done.get(r.userId) ?? new Set<string>()
    set.add(r.id!)
    done.set(r.userId, set)
  }
  return { done, answers: answered }
}

export async function classCourses(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  const { ctx } = cc
  const db = getDb()
  const chain = groupChain(ctx, groupId)
  const maps = await db
    .select({ map: courseClasses, course: courses })
    .from(courseClasses)
    .innerJoin(courses, eq(courseClasses.courseId, courses.id))
    .where(inArray(courseClasses.groupId, chain))
  const outlines = await outlineOf(maps.map((m) => m.course.id))
  const day = await today()
  const teacher = cc.teaches
  const allItems = [...outlines.values()].flat().flatMap((m) => m.items)
  const students = teacher ? await studentsIn(cc) : []
  const progress = await finished(teacher ? students.map((s) => s.id) : [user.id], allItems)
  const mine = progress.done.get(user.id) ?? new Set<string>()
  const canAdd = canFor(ctx, "assignments.manage", [[groupId]])

  // Questions students can answer here, with what they've answered.
  const openQuestionIds = new Set<string>()
  const result = maps.map(({ map, course }) => {
    const modules = outlines.get(course.id) ?? []
    const release = releaseModules(
      modules.map((m) => ({
        openAfterDays: m.openAfterDays,
        afterPrevious: m.afterPrevious,
        total: m.items.length,
        done: m.items.filter((i) => mine.has(i.id)).length,
      })),
      map.startsOn,
      day
    )
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      startsOn: map.startsOn,
      groupId: map.groupId,
      from: map.groupId === groupId ? null : (ctx.groups.find((g) => g.id === map.groupId)?.name ?? null),
      canRemove: map.groupId === groupId && canAdd,
      modules: modules.map((m, i) => {
        const r = release[i]!
        const visible = teacher || r.open
        if (r.open && !teacher) {
          for (const item of m.items) if (item.kind === "question") openQuestionIds.add(item.id)
        }
        return {
          id: m.id,
          title: m.title,
          summary: m.summary,
          opensOn: r.opensOn,
          afterPrevious: m.afterPrevious,
          // A teacher's own progress doesn't count: for them a module is open from its day.
          open: teacher ? day >= r.opensOn : r.open,
          waiting: teacher ? (day >= r.opensOn ? null : ("date" as const)) : r.waiting,
          total: m.items.length,
          done: m.items.filter((item) => mine.has(item.id)).length,
          /** Teachers: how many students finished it. */
          finishedBy: teacher
            ? students.filter((s) => {
                const d = progress.done.get(s.id)
                return m.items.every((item) => d?.has(item.id))
              }).length
            : null,
          items: visible
            ? m.items.map((item) => ({
                ...item,
                href:
                  item.kind === "problem" && item.slug
                    ? item.membersOnly
                      ? `/orgs/${slug}/practice/${item.slug}`
                      : `/problems/${item.slug}`
                    : null,
                done: mine.has(item.id),
              }))
            : [],
        }
      }),
    }
  })

  // Open questions in full, so students answer them on the page.
  const qs = openQuestionIds.size
    ? await db
        .select()
        .from(questions)
        .where(inArray(questions.id, [...openQuestionIds]))
    : []
  const questionData = Object.fromEntries(
    qs.map((q) => {
      const answer = progress.answers.find((a) => a.id === q.id && a.userId === user.id)
      const reveal = answer && (answer.correct || answer.tries >= SHOW_AFTER_TRIES)
      return [
        q.id,
        {
          id: q.id,
          title: q.title,
          kind: q.kind,
          prompt: q.prompt,
          options: q.options,
          answer: answer ? { value: answer.answer, correct: answer.correct, tries: answer.tries } : null,
          solution: reveal ? { correct: q.correct, accepted: q.accepted, explanation: q.explanation } : null,
        },
      ]
    })
  )

  return {
    teacher,
    students: teacher ? students.length : null,
    canAdd,
    courses: result,
    questions: questionData,
    available: canAdd ? await availableCourses(ctx.org.id, user.id) : [],
  }
}

/** Ready courses this college may give its classes: its own and those shared with it. */
async function availableCourses(orgId: string, userId: string) {
  return getDb()
    .select({ id: courses.id, title: courses.title, orgId: courses.orgId })
    .from(courses)
    .where(and(eq(courses.published, true), usableBy(courses, "course", orgId, userId)))
    .orderBy(courses.title)
}

export async function addClassCourse(
  slug: string,
  user: User,
  groupId: string,
  input: { courseId: string; startsOn: string }
) {
  const cc = await classContext(slug, user, groupId)
  needFor(cc.ctx, "assignments.manage", [[groupId]])
  const usable = await usableIds("course", [input.courseId], cc.ctx.org.id, user.id)
  const [course] = await getDb().select().from(courses).where(eq(courses.id, input.courseId))
  if (!course || !usable.has(course.id)) throw notFound("Course not found")
  if (!course.published) {
    throw new ApiError(400, "draft_course", "Mark the course ready before giving it to a class.")
  }
  await getDb()
    .insert(courseClasses)
    .values({ courseId: course.id, groupId, startsOn: input.startsOn, addedBy: user.id })
    .onConflictDoUpdate({
      target: [courseClasses.courseId, courseClasses.groupId],
      set: { startsOn: input.startsOn },
    })
  const name = cc.ctx.groups.find((g) => g.id === groupId)?.name ?? "a class"
  await writeAudit(cc.ctx, "course.assign", `Gave ${name} the course ${course.title}, from ${input.startsOn}`, {
    course: course.title,
    group: name,
  })
}

export async function removeClassCourse(slug: string, user: User, groupId: string, courseId: string) {
  const cc = await classContext(slug, user, groupId)
  needFor(cc.ctx, "assignments.manage", [[groupId]])
  const [gone] = await getDb()
    .delete(courseClasses)
    .where(and(eq(courseClasses.courseId, courseId), eq(courseClasses.groupId, groupId)))
    .returning()
  if (!gone) throw notFound("This class doesn't have that course")
  const name = cc.ctx.groups.find((g) => g.id === groupId)?.name ?? "a class"
  await writeAudit(cc.ctx, "course.unassign", `Took a course off ${name}`, { course: courseId, group: name })
}

/**
 * A student's answer to a practice question in an open module of this class's course.
 * They may try again; a right answer stays right. The answer shows once right or after
 * a few tries.
 */
export async function answerPractice(
  slug: string,
  user: User,
  groupId: string,
  questionId: string,
  answer: string[] | string
) {
  const view = await classCourses(slug, user, groupId)
  if (!view.questions[questionId]) throw notFound("That question isn't open for you here")
  const [q] = await getDb().select().from(questions).where(eq(questions.id, questionId))
  if (!q) throw notFound("Question not found")
  const correct = markQuestion(q, answer).earned === q.points
  const [saved] = await getDb()
    .insert(practiceAnswers)
    .values({ userId: user.id, questionId, answer, correct })
    .onConflictDoUpdate({
      target: [practiceAnswers.userId, practiceAnswers.questionId],
      set: {
        answer,
        correct: raw`${practiceAnswers.correct} or ${correct}`,
        tries: raw`${practiceAnswers.tries} + 1`,
        answeredAt: new Date(),
      },
    })
    .returning()
  const reveal = saved!.correct || saved!.tries >= SHOW_AFTER_TRIES
  return {
    correct,
    tries: saved!.tries,
    solution: reveal ? { correct: q.correct, accepted: q.accepted, explanation: q.explanation } : null,
  }
}
