import {
  certificates,
  courseClasses,
  courses,
  getDb,
  groupMembers,
  orgGroups,
  orgMembers,
  organizations,
  sql,
  type User,
} from "@workspace/db"
import { KINDS, trainingState, type TrainingStatus } from "@workspace/judge"
import { z } from "zod"

import { today } from "@/features/catalog/server"
import { classContext, studentsIn } from "@/features/classes/server"
import { addClassCourse, finished, renewalCutoffs } from "@/features/courses/classes"
import { outlineOf } from "@/features/courses/server"
import { usableBy } from "@/features/library/sharing"
import { notify } from "@/features/notifications/server"
import { canFor, groupChain, orgContext, writeAudit, type OrgContext } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * Assigned training (the "training" module; companies have it from the start): a course
 * given to a department or team with a due date, and for compliance renewed every few
 * months. Built on courses in classes (course_classes.due_on / renew_months): people take
 * it on their team's page like any course, and with renewal, work older than the renewal
 * period no longer counts (features/courses/classes.ts). Where each person is comes from
 * packages/judge/src/training.ts. L&D admins see everything; a manager sees the teams
 * they can see grades for (their team view); employees see their own.
 */

const { and, eq, inArray, isNull } = sql

export const assignTrainingSchema = z.object({
  courseId: z.uuid(),
  groupId: z.uuid(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date").nullable(),
  renewMonths: z.number().int().min(1).max(60).nullable(),
})

const sees = (ctx: OrgContext, id: string) =>
  canFor(ctx, "gradebook.view", [[id]]) || canFor(ctx, "assignments.manage", [[id]])

function needTraining(ctx: OrgContext) {
  if (!ctx.modules.has("training")) throw notFound("Training isn't on here")
}

/** Of a group, the parts this person sees: all of it, or the topmost groups inside they see. */
function scopeIn(ctx: OrgContext, groupId: string) {
  if (sees(ctx, groupId)) return [groupId]
  return ctx.groups
    .filter((g) => g.id !== groupId && groupChain(ctx, g.id).includes(groupId))
    .filter((g) => sees(ctx, g.id) && !(g.parentId && g.parentId !== groupId && sees(ctx, g.parentId)))
    .map((g) => g.id)
}

const nameOf = (ctx: OrgContext, id: string) => ctx.groups.find((g) => g.id === id)?.name ?? "?"
const dayOf = (d: Date) => d.toISOString().slice(0, 10)

type Map_ = { courseId: string; groupId: string; dueOn: string | null; renewMonths: number | null; title: string }

/** Where each person reached by one training is with it, within these groups. */
async function statusOf(slug: string, user: User, ctx: OrgContext, map: Map_, scope: string[], day: string) {
  const people = new Map<string, { id: string; name: string; email: string; team: string }>()
  for (const id of scope) {
    const cc = await classContext(slug, user, id)
    for (const s of await studentsIn(cc)) {
      if (!people.has(s.id)) people.set(s.id, { id: s.id, name: s.name ?? s.handle ?? s.email, email: s.email, team: "" })
    }
  }
  const ids = [...people.keys()]
  // Each person's own team: the deepest group they sit in under the training's group.
  const seats = ids.length
    ? await getDb()
        .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(and(inArray(groupMembers.userId, ids), inArray(groupMembers.groupId, ctx.groups.map((g) => g.id))))
    : []
  for (const p of people.values()) {
    const mine = seats.filter((s) => s.userId === p.id && groupChain(ctx, s.groupId).includes(map.groupId))
    const deepest = mine.sort((a, b) => groupChain(ctx, b.groupId).length - groupChain(ctx, a.groupId).length)[0]
    p.team = deepest ? nameOf(ctx, deepest.groupId) : nameOf(ctx, map.groupId)
  }
  const outlines = await outlineOf([map.courseId])
  const items = (outlines.get(map.courseId) ?? []).flatMap((m) => m.items)
  const { done, latest } = await finished(
    ids,
    items,
    renewalCutoffs([{ courseId: map.courseId, renewMonths: map.renewMonths }], outlines, day)
  )
  // With renewal, work from before the cutoff doesn't count; it still shows who had it done
  // once and has lapsed (expired), as against who never did it.
  const ever = map.renewMonths ? await finished(ids, items) : null
  const certs = ids.length
    ? await getDb()
        .select({ userId: certificates.userId, code: certificates.code, expiresOn: certificates.expiresOn })
        .from(certificates)
        .where(
          and(
            eq(certificates.kind, "course"),
            eq(certificates.sourceId, map.courseId),
            isNull(certificates.revokedAt),
            inArray(certificates.userId, ids)
          )
        )
    : []
  return [...people.values()]
    .map((p) => {
      const all = items.length > 0 && items.every((i) => done.get(p.id)?.has(i.id))
      const times = [...(latest.get(p.id)?.values() ?? [])].map((t) => t.getTime())
      const state = trainingState({
        doneSince: all ? dayOf(new Date(Math.min(...times))) : lapsedSince(ever, p.id, items),
        dueOn: map.dueOn,
        renewMonths: map.renewMonths,
        today: day,
      })
      const cert = certs
        .filter((c) => c.userId === p.id && (!c.expiresOn || c.expiresOn >= day))
        .sort((a, b) => (b.expiresOn ?? "9").localeCompare(a.expiresOn ?? "9"))[0]
      return {
        ...p,
        ...state,
        progress: { done: items.filter((i) => done.get(p.id)?.has(i.id)).length, total: items.length },
        completedOn: all ? dayOf(new Date(Math.max(...times))) : null,
        certificate: cert?.code ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * For renewed training someone hasn't done in the current period: when their last full
 * completion began, if they ever finished it (so it shows as expired); null if never.
 */
function lapsedSince(
  ever: Awaited<ReturnType<typeof finished>> | null,
  userId: string,
  items: { id: string }[]
) {
  if (!ever || items.length === 0 || !items.every((i) => ever.done.get(userId)?.has(i.id))) return null
  const times = items.map((i) => ever.latest.get(userId)!.get(i.id)!.getTime())
  return dayOf(new Date(Math.min(...times)))
}

const COUNT_KEYS: TrainingStatus[] = ["overdue", "expired", "due", "expiring", "todo", "done"]
const countsOf = (rows: { status: TrainingStatus }[]) =>
  Object.fromEntries(COUNT_KEYS.map((k) => [k, rows.filter((r) => r.status === k).length])) as Record<
    TrainingStatus,
    number
  >

async function trainingMaps(ctx: OrgContext) {
  const ids = ctx.groups.map((g) => g.id)
  if (!ids.length) return []
  return getDb()
    .select({
      courseId: courseClasses.courseId,
      groupId: courseClasses.groupId,
      dueOn: courseClasses.dueOn,
      renewMonths: courseClasses.renewMonths,
      startsOn: courseClasses.startsOn,
      title: courses.title,
      published: courses.published,
    })
    .from(courseClasses)
    .innerJoin(courses, eq(courseClasses.courseId, courses.id))
    .where(inArray(courseClasses.groupId, ids))
}

/** Every training this person can follow, with how many are done, due, overdue or expiring. */
export async function listTraining(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needTraining(ctx)
  const day = await today()
  const maps = (await trainingMaps(ctx)).filter((m) => scopeIn(ctx, m.groupId).length > 0)
  const rows = await Promise.all(
    maps.map(async (m) => {
      const scope = scopeIn(ctx, m.groupId)
      const people = await statusOf(slug, user, ctx, m, scope, day)
      return {
        courseId: m.courseId,
        groupId: m.groupId,
        course: m.title,
        group: nameOf(ctx, m.groupId),
        dueOn: m.dueOn,
        renewMonths: m.renewMonths,
        people: people.length,
        counts: countsOf(people),
        whole: scope.includes(m.groupId),
        canManage: canFor(ctx, "assignments.manage", [[m.groupId]]),
      }
    })
  )
  const kind = KINDS[ctx.org.type]
  const canAssign = ctx.groups.some((g) => canFor(ctx, "assignments.manage", [[g.id]]))
  return {
    day,
    terms: kind.terms,
    levels: ctx.org.groupLevels,
    trainings: rows.sort((a, b) => (a.dueOn ?? "9").localeCompare(b.dueOn ?? "9") || a.course.localeCompare(b.course)),
    canAssign,
    /** Ready courses to assign, and groups to assign them to. */
    courses: canAssign
      ? (await availableToAssign(ctx, user)).map((c) => ({ id: c.id, title: c.title }))
      : [],
    groups: ctx.groups
      .filter((g) => canFor(ctx, "assignments.manage", [[g.id]]))
      .map((g) => ({ id: g.id, name: g.name, parentId: g.parentId })),
  }
}

async function availableToAssign(ctx: OrgContext, user: User) {
  return getDb()
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(and(eq(courses.published, true), usableBy(courses, "course", ctx.org.id, user.id)))
    .orderBy(courses.title)
}

async function mapOf(ctx: OrgContext, groupId: string, courseId: string) {
  const map = (await trainingMaps(ctx)).find((m) => m.groupId === groupId && m.courseId === courseId)
  if (!map) throw notFound("No such training")
  const scope = scopeIn(ctx, groupId)
  if (!scope.length) throw notFound("No such training")
  return { map, scope }
}

/** One training: each person it reaches (that this person sees), and where they are. */
export async function trainingDetail(slug: string, user: User, groupId: string, courseId: string) {
  const ctx = await orgContext(slug, user)
  needTraining(ctx)
  const { map, scope } = await mapOf(ctx, groupId, courseId)
  const day = await today()
  const people = await statusOf(slug, user, ctx, map, scope, day)
  return {
    day,
    terms: KINDS[ctx.org.type].terms,
    training: {
      courseId,
      groupId,
      course: map.title,
      group: nameOf(ctx, groupId),
      dueOn: map.dueOn,
      renewMonths: map.renewMonths,
      whole: scope.includes(groupId),
    },
    people,
    counts: countsOf(people),
    canManage: canFor(ctx, "assignments.manage", [[groupId]]),
  }
}

/** Assigns a course to a group as training (or changes its due date and renewal). */
export async function assignTraining(slug: string, user: User, input: z.infer<typeof assignTrainingSchema>) {
  const ctx = await orgContext(slug, user)
  needTraining(ctx)
  const day = await today()
  if (input.dueOn && input.dueOn < day) throw new ApiError(400, "past_due", "The due date has already passed.")
  const before = (await trainingMaps(ctx)).find((m) => m.groupId === input.groupId && m.courseId === input.courseId)
  // Giving the course checks the permission, that the course is ready and usable here.
  await addClassCourse(slug, user, input.groupId, { courseId: input.courseId, startsOn: before?.startsOn ?? day })
  await getDb()
    .update(courseClasses)
    .set({ dueOn: input.dueOn, renewMonths: input.renewMonths })
    .where(and(eq(courseClasses.courseId, input.courseId), eq(courseClasses.groupId, input.groupId)))
  const [course] = await getDb().select({ title: courses.title }).from(courses).where(eq(courses.id, input.courseId))
  await writeAudit(
    ctx,
    "training.assign",
    `${before ? "Changed" : "Assigned"} training ${course?.title} for ${nameOf(ctx, input.groupId)}: ${
      input.dueOn ? `due ${input.dueOn}` : "no due date"
    }${input.renewMonths ? `, renewed every ${input.renewMonths} months` : ""}`
  )
  return trainingDetail(slug, user, input.groupId, input.courseId)
}

const PENDING: TrainingStatus[] = ["overdue", "expired", "due", "expiring", "todo"]

/** A reminder to everyone (this person sees) who hasn't finished it, or must renew it. */
export async function remindTraining(slug: string, user: User, groupId: string, courseId: string) {
  const ctx = await orgContext(slug, user)
  needTraining(ctx)
  const { map, scope } = await mapOf(ctx, groupId, courseId)
  const day = await today()
  const people = (await statusOf(slug, user, ctx, map, scope, day)).filter((p) => PENDING.includes(p.status))
  for (const p of people) {
    await notify([p.id], {
      kind: "training_due",
      title:
        p.status === "expired" || p.status === "expiring"
          ? `Time to renew your training: ${map.title}`
          : `Training to finish: ${map.title}`,
      body: p.needBy
        ? `${p.status === "overdue" || p.status === "expired" ? "It was needed by" : "Needed by"} ${p.needBy}. ${p.progress.done} of ${p.progress.total} done.`
        : `${p.progress.done} of ${p.progress.total} done.`,
      href: `/orgs/${slug}/classes/${groupId}`,
      orgId: ctx.org.id,
    })
  }
  await writeAudit(ctx, "training.remind", `Reminded ${people.length} about ${map.title} (${nameOf(ctx, groupId)})`)
  return { reminded: people.length }
}

/** A person's own training here: each course given to a group they're in, and where they are. */
export async function myTraining(ctx: OrgContext, user: User) {
  if (!ctx.modules.has("training")) return null
  const seats = await getDb()
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, user.id), inArray(groupMembers.groupId, ctx.groups.map((g) => g.id))))
  if (!seats.length) return []
  const reach = new Map<string, string>()
  for (const s of seats) for (const id of groupChain(ctx, s.groupId)) if (!reach.has(id)) reach.set(id, s.groupId)
  const maps = (await trainingMaps(ctx)).filter((m) => m.published && reach.has(m.groupId))
  // A course given at several levels: the earliest due date and shortest renewal hold.
  const byCourse = new Map<string, Map_ & { seat: string }>()
  for (const m of maps) {
    const had = byCourse.get(m.courseId)
    byCourse.set(m.courseId, {
      ...m,
      seat: reach.get(m.groupId)!,
      dueOn: [had?.dueOn, m.dueOn].filter((x): x is string => !!x).sort()[0] ?? null,
      renewMonths: Math.min(had?.renewMonths ?? Infinity, m.renewMonths ?? Infinity) === Infinity
        ? null
        : Math.min(had?.renewMonths ?? Infinity, m.renewMonths ?? Infinity),
    })
  }
  const list = [...byCourse.values()]
  if (!list.length) return []
  const day = await today()
  const outlines = await outlineOf(list.map((m) => m.courseId))
  const { done, latest } = await finished(
    [user.id],
    [...outlines.values()].flat().flatMap((m) => m.items),
    renewalCutoffs(list, outlines, day)
  )
  const mine = done.get(user.id) ?? new Set<string>()
  const times = latest.get(user.id) ?? new Map<string, Date>()
  const ever = list.some((m) => m.renewMonths)
    ? await finished([user.id], [...outlines.values()].flat().flatMap((m) => m.items))
    : null
  const rank: Record<TrainingStatus, number> = { overdue: 0, expired: 1, due: 2, expiring: 3, todo: 4, done: 5 }
  return list
    .map((m) => {
      const items = (outlines.get(m.courseId) ?? []).flatMap((x) => x.items)
      const all = items.length > 0 && items.every((i) => mine.has(i.id))
      const doneSince = all
        ? dayOf(new Date(Math.min(...items.map((i) => times.get(i.id)!.getTime()))))
        : m.renewMonths
          ? lapsedSince(ever, user.id, items)
          : null
      return {
        courseId: m.courseId,
        course: m.title,
        href: `/orgs/${ctx.org.slug}/classes/${m.seat}`,
        dueOn: m.dueOn,
        renewMonths: m.renewMonths,
        progress: { done: items.filter((i) => mine.has(i.id)).length, total: items.length },
        ...trainingState({ doneSince, dueOn: m.dueOn, renewMonths: m.renewMonths, today: day }),
      }
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.needBy ?? "9").localeCompare(b.needBy ?? "9"))
}

/** For the bell: training that's overdue, due within a week, expired or about to, in any organization. */
export async function trainingReminders(user: User) {
  const orgs = await getDb()
    .selectDistinct({ slug: organizations.slug })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .innerJoin(orgGroups, eq(orgGroups.orgId, organizations.id))
    .innerJoin(courseClasses, eq(courseClasses.groupId, orgGroups.id))
    .where(and(eq(orgMembers.userId, user.id), eq(orgMembers.status, "active")))
  const out = []
  for (const o of orgs) {
    const ctx = await orgContext(o.slug, user).catch(() => null)
    if (!ctx) continue
    for (const t of (await myTraining(ctx, user)) ?? []) {
      if (!["overdue", "expired", "due", "expiring"].includes(t.status)) continue
      out.push({ ...t, org: ctx.org.name })
    }
  }
  return out
}
