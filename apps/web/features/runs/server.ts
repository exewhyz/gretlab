import { certificates, getDb, groupMembers, sql, users, type User } from "@workspace/db"
import { KINDS, runState } from "@workspace/judge"

import { byName } from "@/lib/by-name"
import { today } from "@/features/catalog/server"
import { learnerSignals } from "@/features/classes/warnings"
import { canFor, groupChain, orgContext, type OrgContext } from "@/features/orgs/server"
import { notFound } from "@/lib/api/route"

/*
 * Runs: groups that run between dates, in kinds that have them (a cohort and its pods, a
 * coaching batch). The program's page lists them; a run's progress page shows each
 * learner's work, attendance, last activity and early warning, by pod with its mentor;
 * graduation issues certificates (features/certificates, kind "graduation"). Program
 * managers see every run; a mentor sees the pods they lead or teach.
 */

const { and, eq, inArray, isNull } = sql

const nameOf = (ctx: OrgContext, id: string) => ctx.groups.find((g) => g.id === id)?.name ?? "?"
const inside = (ctx: OrgContext, id: string) =>
  ctx.groups.filter((g) => groupChain(ctx, g.id).includes(id)).map((g) => g.id)
const sees = (ctx: OrgContext, id: string) => canFor(ctx, "gradebook.view", [[id]])
/** What the groups inside one are called (a cohort's Pods). */
const levelInside = (ctx: OrgContext, id: string) =>
  ctx.org.groupLevels[groupChain(ctx, id).length] ?? "Group"

function needRuns(ctx: OrgContext) {
  if (!KINDS[ctx.org.type].groupDates) throw notFound("Not part of this organization")
}

async function leadNames(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))]
  if (!wanted.length) return new Map<string, string>()
  const rows = await getDb()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, wanted))
  return new Map(rows.map((r) => [r.id, r.name ?? r.email]))
}

/** Runs this person can see: every one for program managers, else those with a pod they see. */
export async function listRuns(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needRuns(ctx)
  const day = await today()
  const runs = ctx.groups.filter(
    (g) => g.startsOn && g.endsOn && inside(ctx, g.id).some((id) => sees(ctx, id))
  )
  const ids = runs.flatMap((r) => inside(ctx, r.id))
  const seats = ids.length
    ? await getDb()
        .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
        .from(groupMembers)
        .where(inArray(groupMembers.groupId, ids))
    : []
  const leads = await leadNames(ctx.groups.map((g) => g.leadId))
  const count = (id: string) =>
    new Set(seats.filter((s) => groupChain(ctx, s.groupId).includes(id)).map((s) => s.userId)).size
  const kind = KINDS[ctx.org.type]
  return {
    terms: kind.terms,
    day,
    canEdit: canFor(ctx, "org.groups.edit", []),
    runs: runs
      .map((r) => ({
        id: r.id,
        name: r.name,
        startsOn: r.startsOn!,
        endsOn: r.endsOn!,
        state: runState(r.startsOn!, r.endsOn!, day),
        people: count(r.id),
        lead: r.leadId ? (leads.get(r.leadId) ?? null) : null,
        podLevel: levelInside(ctx, r.id),
        pods: ctx.groups
          .filter((g) => g.parentId === r.id)
          .map((g) => ({
            id: g.id,
            name: g.name,
            people: count(g.id),
            lead: g.leadId ? (leads.get(g.leadId) ?? null) : null,
            mine: g.leadId === user.id,
          }))
          .sort((a, b) => byName(a.name, b.name)),
      }))
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn)),
  }
}

/** One run: each learner's progress, by pod, for whoever sees it (or some of its pods). */
export async function runProgress(slug: string, user: User, groupId: string) {
  const ctx = await orgContext(slug, user)
  needRuns(ctx)
  const run = ctx.groups.find((g) => g.id === groupId)
  if (!run || !run.startsOn || !run.endsOn) throw notFound("No such run")
  // The whole run for program managers; otherwise the pods this person sees.
  const scopes = sees(ctx, groupId)
    ? [groupId]
    : ctx.groups.filter((g) => g.parentId === groupId && sees(ctx, g.id)).map((g) => g.id)
  if (!scopes.length) throw notFound("No such run")
  const signals = (await Promise.all(scopes.map((id) => learnerSignals(slug, user, id)))).flatMap(
    (s) => s.students
  )
  const ids = [...new Set(signals.map((s) => s.id))]
  const pods = ctx.groups.filter((g) => g.parentId === groupId)
  const [seats, graduated, day] = await Promise.all([
    ids.length
      ? getDb()
          .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
          .from(groupMembers)
          .where(and(inArray(groupMembers.userId, ids), inArray(groupMembers.groupId, inside(ctx, groupId))))
      : [],
    ids.length
      ? getDb()
          .select({ userId: certificates.userId, code: certificates.code })
          .from(certificates)
          .where(
            and(
              eq(certificates.kind, "graduation"),
              eq(certificates.sourceId, groupId),
              isNull(certificates.revokedAt),
              inArray(certificates.userId, ids)
            )
          )
      : [],
    today(),
  ])
  const leads = await leadNames([run.leadId, ...pods.map((p) => p.leadId)])
  const podOf = (userId: string) => {
    const seat = seats.find((s) => s.userId === userId && s.groupId !== groupId)
    return seat ? (pods.find((p) => groupChain(ctx, seat.groupId).includes(p.id))?.id ?? null) : null
  }
  const seen = new Set<string>()
  const learners = signals
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .map((s) => ({
      ...s,
      pod: podOf(s.id),
      graduated: graduated.find((g) => g.userId === s.id)?.code ?? null,
    }))
    .sort((a, b) => byName(a.name, b.name))
  const kind = KINDS[ctx.org.type]
  return {
    terms: kind.terms,
    run: {
      id: run.id,
      name: run.name,
      startsOn: run.startsOn,
      endsOn: run.endsOn,
      state: runState(run.startsOn, run.endsOn, day),
      lead: run.leadId ? (leads.get(run.leadId) ?? null) : null,
      podLevel: levelInside(ctx, run.id),
    },
    pods: pods
      .filter((p) => scopes.includes(groupId) || scopes.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        lead: p.leadId ? (leads.get(p.leadId) ?? null) : null,
        mine: p.leadId === user.id,
      }))
      .sort((a, b) => byName(a.name, b.name)),
    learners,
    whole: scopes.includes(groupId),
    canGraduate: canFor(ctx, "assignments.manage", [[groupId]]),
  }
}

/**
 * For a home: the runs this person is in (with their pod and its mentor) and the pods
 * they lead. Empty for kinds without runs.
 */
export async function homeRuns(ctx: OrgContext, user: User) {
  const kind = KINDS[ctx.org.type]
  if (!kind.groupDates) return null
  const runs = ctx.groups.filter((g) => g.startsOn && g.endsOn)
  if (!runs.length) return { learning: [], leading: [] }
  const [seats, day] = await Promise.all([
    getDb()
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, user.id),
          inArray(
            groupMembers.groupId,
            runs.flatMap((r) => inside(ctx, r.id))
          )
        )
      ),
    today(),
  ])
  const leads = await leadNames(ctx.groups.map((g) => g.leadId))
  const learning = runs
    .filter((r) => seats.some((s) => groupChain(ctx, s.groupId).includes(r.id)))
    .map((r) => {
      const seat = seats.find((s) => groupChain(ctx, s.groupId).includes(r.id))!
      // The nearest group with a lead, from their own up to the run.
      const chain = groupChain(ctx, seat.groupId)
      const led = chain.slice(0, chain.indexOf(r.id) + 1).map((id) => ctx.groups.find((g) => g.id === id)!).find((g) => g.leadId)
      const pod = seat.groupId !== r.id ? (chain[chain.indexOf(r.id) - 1] ?? null) : null
      return {
        id: r.id,
        name: r.name,
        startsOn: r.startsOn!,
        endsOn: r.endsOn!,
        state: runState(r.startsOn!, r.endsOn!, day),
        pod: pod ? { id: pod, name: nameOf(ctx, pod) } : null,
        lead: led?.leadId ? (leads.get(led.leadId) ?? null) : null,
      }
    })
  const leading = ctx.groups
    .filter((g) => g.leadId === user.id)
    .map((g) => {
      const run = runs.find((r) => groupChain(ctx, g.id).includes(r.id))
      return run
        ? {
            id: g.id,
            name: g.name,
            run: { id: run.id, name: run.name, state: runState(run.startsOn!, run.endsOn!, day) },
          }
        : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  return { learning, leading }
}
