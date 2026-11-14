import {
  getDb,
  groupMembers,
  orgGroups,
  orgMembers,
  orgRoles,
  roleAssignments,
  sql,
  users,
  type User,
} from "@workspace/db"
import {
  inAudience,
  type Audience,
  KINDS,
  type Permission,
  runProblem,
} from "@workspace/judge"
import type { z } from "zod"

import { ApiError, notFound } from "@/lib/api/route"

import { rolePermissions } from "./access"

import type { groupSchema, groupRunSchema } from "./schemas"

const { and, count, eq, inArray } = sql
import {
  NO_GROUP,
  audit,
  can,
  canAnywhere,
  chainOf,
  checkAudience,
  context,
  forbidden,
  giveRole,
  groupIn,
  isLeaf,
  leavesUnder,
  need,
  needLeaf,
  needSubset,
  settleBelow,
  systemRole,
  type OrgContext,
} from "./core"

/* Groups: the tree, open groups a community's members join, and the people in each. */

/* ---------- groups ---------- */

export async function listGroups(slug: string, user: User) {
  const ctx = await context(slug, user)
  const rows = ctx.groups.length
    ? await getDb()
        .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          inArray(
            groupMembers.groupId,
            ctx.groups.map((g) => g.id)
          )
        )
    : []
  const leadIds = [
    ...new Set(ctx.groups.flatMap((g) => (g.leadId ? [g.leadId] : []))),
  ]
  const leads = leadIds.length
    ? (
        await getDb()
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, leadIds))
      ).map((u) => ({ id: u.id, name: u.name ?? u.email }))
    : []
  const kind = KINDS[ctx.org.type]
  return {
    levels: ctx.org.groupLevels,
    run: {
      dates: kind.groupDates,
      lead: kind.leadPerGroup,
      leadTerm: kind.terms.groupLead,
      open: kind.openGroups,
    },
    canManageAll: can(ctx, "org.groups.manage"),
    groups: ctx.groups
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => {
        const direct = rows.filter((r) => r.groupId === g.id).length
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          parentId: g.parentId,
          depth: chainOf(ctx, g.id).length - 1,
          // Everyone in it or in a group inside it, counted once.
          members: new Set(
            rows
              .filter((r) => chainOf(ctx, r.groupId).includes(g.id))
              .map((r) => r.userId)
          ).size,
          // People sitting directly in a group that now has groups inside it.
          notPlaced: isLeaf(ctx, g.id) ? 0 : direct,
          canManage: can(ctx, "org.groups.manage", g.id),
          canEdit: can(ctx, "org.groups.edit", g.id),
          startsOn: g.startsOn,
          endsOn: g.endsOn,
          open: g.open,
          lead: g.leadId
            ? (leads.find((l) => l.id === g.leadId) ?? null)
            : null,
        }
      }),
  }
}

export async function createGroup(
  slug: string,
  user: User,
  input: z.infer<typeof groupSchema>
) {
  const ctx = await context(slug, user)
  // Top-level groups need the permission org-wide; subgroups, on their parent.
  need(ctx, "org.groups.create", input.parentId)
  if (input.parentId) {
    const depth = chainOf(ctx, groupIn(ctx, input.parentId).id).length
    if (depth >= ctx.org.groupLevels.length) {
      throw new ApiError(
        400,
        "too_deep",
        `Groups go ${ctx.org.groupLevels.length} level${ctx.org.groupLevels.length > 1 ? "s" : ""} deep here. Add a level in Settings first.`
      )
    }
  }
  return getDb().transaction(async (tx) => {
    const [group] = await tx
      .insert(orgGroups)
      .values({ orgId: ctx.org.id, ...input })
      .returning()
    await audit(tx, ctx, "group.create", `Created group ${group!.name}`)
    // A group's first group inside takes its people down with it, so they stay in the last
    // level. With other groups already inside, nobody sits directly in the parent anyway.
    let movedDown = 0
    if (input.parentId && isLeaf(ctx, input.parentId)) {
      const people = await tx
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, input.parentId))
      if (people.length) {
        await tx
          .insert(groupMembers)
          .values(people.map((p) => ({ groupId: group!.id, userId: p.userId })))
          .onConflictDoNothing()
        await tx
          .delete(groupMembers)
          .where(eq(groupMembers.groupId, input.parentId))
        movedDown = people.length
      }
    }
    const [waiting] = input.parentId
      ? await tx
          .select({ total: count() })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, input.parentId))
      : []
    return { ...group!, movedDown, parentNotPlaced: waiting?.total ?? 0 }
  })
}

export async function updateGroup(
  slug: string,
  user: User,
  id: string,
  input: Pick<z.infer<typeof groupSchema>, "name" | "description">
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  need(ctx, "org.groups.edit", id)
  await getDb().transaction(async (tx) => {
    await tx.update(orgGroups).set(input).where(eq(orgGroups.id, id))
    await audit(
      tx,
      ctx,
      "group.update",
      `Renamed ${group.name} to ${input.name}`
    )
  })
}

/**
 * A group's run and lead, for kinds that have them: a cohort's dates, a pod's mentor. The
 * lead is given the kind's instructor role on the group if nothing gives them teaching
 * there yet, so they can run it (it stays when they stop leading; take it off in People).
 */
export async function setGroupRun(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof groupRunSchema>
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  need(ctx, "org.groups.edit", id)
  const kind = KINDS[ctx.org.type]
  const datesGiven = input.startsOn !== undefined || input.endsOn !== undefined
  if (datesGiven && !kind.groupDates)
    throw new ApiError(
      400,
      "not_for_kind",
      `${kind.terms.groups} don't run between dates in a ${kind.noun}.`
    )
  if (input.open !== undefined && !kind.openGroups)
    throw new ApiError(
      400,
      "not_for_kind",
      `People don't join ${kind.terms.groups.toLowerCase()} themselves in a ${kind.noun}.`
    )
  if (input.leadId !== undefined && !kind.leadPerGroup)
    throw new ApiError(
      400,
      "not_for_kind",
      `A ${kind.noun} names its ${kind.terms.groupLead.toLowerCase()}s per year, in Academic years.`
    )
  const startsOn =
    input.startsOn === undefined ? group.startsOn : input.startsOn
  const endsOn = input.endsOn === undefined ? group.endsOn : input.endsOn
  const problem = runProblem(startsOn, endsOn)
  if (problem) throw new ApiError(400, "bad_run", problem)
  let lead: { id: string; email: string; name: string | null } | null = null
  if (input.leadId) {
    const [row] = await getDb()
      .select({ id: users.id, email: users.email, name: users.name })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(
        and(
          eq(orgMembers.orgId, ctx.org.id),
          eq(orgMembers.userId, input.leadId),
          eq(orgMembers.status, "active")
        )
      )
    if (!row)
      throw new ApiError(
        400,
        "not_member",
        "The lead has to be an active member."
      )
    lead = row
  }
  const instructor = lead
    ? await systemRole(getDb(), ctx.org.id, "teacher")
    : null
  if (instructor) needSubset(ctx, rolePermissions(instructor), id)
  await getDb().transaction(async (tx) => {
    await tx
      .update(orgGroups)
      .set({
        startsOn,
        endsOn,
        ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
        ...(input.open !== undefined ? { open: input.open } : {}),
      })
      .where(eq(orgGroups.id, id))
    if (lead && instructor) {
      const [held] = await tx
        .select({
          systemKey: orgRoles.systemKey,
          permissions: orgRoles.permissions,
          groupId: roleAssignments.groupId,
        })
        .from(roleAssignments)
        .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
        .where(
          and(
            eq(roleAssignments.orgId, ctx.org.id),
            eq(roleAssignments.userId, lead.id)
          )
        )
        .then((rows) =>
          rows.filter(
            (r) =>
              (r.groupId === null || chainOf(ctx, id).includes(r.groupId)) &&
              rolePermissions(r).includes("teaching.log")
          )
        )
      if (!held) await giveRole(tx, ctx.org.id, lead.id, instructor.id, id)
    }
    const parts = [
      datesGiven
        ? startsOn
          ? `runs ${startsOn} to ${endsOn}`
          : "no dates"
        : null,
      input.leadId !== undefined
        ? lead
          ? `${kind.terms.groupLead} ${lead.name ?? lead.email}`
          : `no ${kind.terms.groupLead.toLowerCase()}`
        : null,
      input.open !== undefined
        ? input.open
          ? "open to join"
          : "closed"
        : null,
    ].filter(Boolean)
    await audit(tx, ctx, "group.run", `${group.name}: ${parts.join(", ")}`)
  })
  return {
    startsOn,
    endsOn,
    leadId: input.leadId === undefined ? group.leadId : input.leadId,
    open: input.open ?? group.open,
  }
}

/* ---------- open groups (a community's) ---------- */

function needOpenGroups(ctx: OrgContext) {
  if (!KINDS[ctx.org.type].openGroups)
    throw notFound("Not part of this organization")
  if (ctx.membership?.status !== "active")
    throw forbidden("Join the organization first.")
}

/** Groups members may join themselves, with who leads them and whether this person is in. */
export async function openGroups(slug: string, user: User) {
  const ctx = await context(slug, user)
  needOpenGroups(ctx)
  const open = ctx.groups.filter((g) => g.open)
  const ids = open.map((g) => g.id)
  const [seats, leads] = await Promise.all([
    ids.length
      ? getDb()
          .select({
            groupId: groupMembers.groupId,
            userId: groupMembers.userId,
          })
          .from(groupMembers)
          .where(inArray(groupMembers.groupId, ids))
      : [],
    getDb()
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(
        inArray(
          users.id,
          [
            ...new Set(open.flatMap((g) => (g.leadId ? [g.leadId] : []))),
          ].concat(["00000000-0000-0000-0000-000000000000"])
        )
      ),
  ])
  const kind = KINDS[ctx.org.type]
  return {
    terms: kind.terms,
    groups: open
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        members: seats.filter((s) => s.groupId === g.id).length,
        lead: g.leadId
          ? (leads.find((l) => l.id === g.leadId)?.name ?? null)
          : null,
        mine: seats.some((s) => s.groupId === g.id && s.userId === user.id),
      }))
      .sort(
        (a, b) =>
          Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name)
      ),
  }
}

/** Joins an open group, or leaves one. */
export async function joinOpenGroup(
  slug: string,
  user: User,
  id: string,
  join: boolean
) {
  const ctx = await context(slug, user)
  needOpenGroups(ctx)
  const group = groupIn(ctx, id)
  if (!group.open)
    throw forbidden(
      `${group.name} isn't open to join; ask its ${KINDS[ctx.org.type].terms.groupLead.toLowerCase()}.`
    )
  await getDb().transaction(async (tx) => {
    if (join) {
      const [added] = await tx
        .insert(groupMembers)
        .values({ groupId: id, userId: user.id })
        .onConflictDoNothing()
        .returning()
      if (added) await audit(tx, ctx, "group.join", `Joined ${group.name}`)
    } else {
      const [gone] = await tx
        .delete(groupMembers)
        .where(
          and(eq(groupMembers.groupId, id), eq(groupMembers.userId, user.id))
        )
        .returning()
      if (gone) await audit(tx, ctx, "group.leave", `Left ${group.name}`)
    }
  })
  return openGroups(slug, user)
}

/**
 * Deletes a group and everything inside it. A group with people in it (or in a group
 * inside it) is only deleted with `force`: they're then taken out of it, not moved
 * anywhere, so nobody ends up counted in groups they weren't in. Otherwise it's refused
 * with the count, so the person can empty it first or confirm.
 */
export async function deleteGroup(
  slug: string,
  user: User,
  id: string,
  force: boolean
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  // Deleting needs the permission above the group, not just on it.
  need(ctx, "org.groups.delete", group.parentId)
  const doomed = ctx.groups
    .filter((g) => chainOf(ctx, g.id).includes(id))
    .map((g) => g.id)
  await getDb().transaction(async (tx) => {
    const people = await tx
      .selectDistinct({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, doomed))
    if (people.length > 0 && !force) {
      throw new ApiError(
        409,
        "group_not_empty",
        `${group.name} has ${people.length} ${people.length === 1 ? "person" : "people"} in it. Empty it first, or delete it and take them out of it.`
      )
    }
    // Their places in these groups go with the groups (the rows cascade).
    await tx.delete(orgGroups).where(inArray(orgGroups.id, doomed))
    await audit(
      tx,
      ctx,
      "group.delete",
      `Deleted group ${group.name}${doomed.length > 1 ? ` and ${doomed.length - 1} inside it` : ""}${
        people.length
          ? `; took ${people.length} ${people.length === 1 ? "person" : "people"} out of it`
          : ""
      }`
    )
  })
}

/* ---------- a group's people, and who an audience reaches ---------- */

/** Everyone in a group or a group inside it, with where each sits. */
export async function groupPeople(slug: string, user: User, groupId: string) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, groupId)
  need(ctx, "org.members.view", groupId)
  const inside = ctx.groups
    .filter((g) => chainOf(ctx, g.id).includes(groupId))
    .map((g) => g.id)
  const rows = await getDb()
    .select({
      userId: groupMembers.userId,
      groupId: groupMembers.groupId,
      name: users.name,
      email: users.email,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(inArray(groupMembers.groupId, inside))
  const pathFrom = (id: string) =>
    chainOf(ctx, id)
      .slice(0, chainOf(ctx, id).indexOf(groupId))
      .reverse()
      .map((x) => groupIn(ctx, x).name)
      .join(" › ")
  const people = new Map<
    string,
    {
      userId: string
      name: string | null
      email: string
      direct: boolean
      in: string[]
    }
  >()
  for (const r of rows) {
    const p = people.get(r.userId) ?? {
      userId: r.userId,
      name: r.name,
      email: r.email,
      direct: false,
      in: [],
    }
    if (r.groupId === groupId) p.direct = true
    else p.in.push(pathFrom(r.groupId))
    people.set(r.userId, p)
  }
  const leaf = isLeaf(ctx, groupId)
  return {
    group: { id: group.id, name: group.name },
    /** Last-level groups inside this one, to place people into. */
    places: leaf
      ? []
      : inside
          .filter((id) => id !== groupId && isLeaf(ctx, id))
          .map((id) => ({
            id,
            path: chainOf(ctx, id)
              .slice(0, chainOf(ctx, id).indexOf(groupId))
              .reverse()
              .map((x) => groupIn(ctx, x).name)
              .join(" › "),
          })),
    /** Everyone can be added here; a group with groups inside spreads them into its last level. */
    canAdd: true,
    canManage: can(ctx, "org.members.manage", groupId),
    people: [...people.values()]
      .map((p) => ({ ...p, notPlaced: p.direct && !leaf }))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
  }
}

export async function addToGroup(
  slug: string,
  user: User,
  groupId: string,
  userIds: string[]
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, groupId)
  need(ctx, "org.members.groups", groupId)
  const targets = leavesUnder(ctx, groupId)
  const members = await getDb()
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, ctx.org.id),
        eq(orgMembers.status, "active"),
        inArray(orgMembers.userId, userIds.length ? userIds : [NO_GROUP])
      )
    )
  if (members.length !== new Set(userIds).size) {
    throw new ApiError(
      400,
      "not_member",
      "Only active members can be added to a group."
    )
  }
  await getDb().transaction(async (tx) => {
    await tx
      .insert(groupMembers)
      .values(
        targets.flatMap((target) =>
          userIds.map((userId) => ({ groupId: target, userId }))
        )
      )
      .onConflictDoNothing()
    for (const userId of userIds) {
      for (const target of targets) await settleBelow(tx, ctx, userId, target)
    }
    await audit(
      tx,
      ctx,
      "member.groups",
      `Added ${userIds.length} ${userIds.length === 1 ? "person" : "people"} to ${group.name}`
    )
  })
}

/**
 * Takes people out of a group and every group inside it: removing someone from 3rd Year
 * means from its sections too. Their membership of the organization stays.
 */
export async function removeFromGroup(
  slug: string,
  user: User,
  groupId: string,
  userIds: string[]
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, groupId)
  need(ctx, "org.members.groups", groupId)
  if (userIds.length === 0) return { removed: 0 }
  return getDb().transaction(async (tx) => {
    const removed = await tx
      .delete(groupMembers)
      .where(
        and(
          inArray(groupMembers.groupId, insideIds(ctx, groupId)),
          inArray(groupMembers.userId, userIds)
        )
      )
      .returning({ userId: groupMembers.userId })
    const people = new Set(removed.map((r) => r.userId)).size
    await audit(
      tx,
      ctx,
      "member.groups",
      `Took ${people} ${people === 1 ? "person" : "people"} out of ${group.name}`
    )
    return { removed: people }
  })
}

/** How many members an audience reaches, and a few names, while it's being chosen. */
export async function previewAudience(
  slug: string,
  user: User,
  audience: Audience
) {
  const ctx = await context(slug, user)
  if (
    !["assignments.manage", "contests.manage", "notices.manage"].some((p) =>
      canAnywhere(ctx, p as Permission)
    )
  ) {
    throw forbidden()
  }
  checkAudience(ctx, audience)
  const db = getDb()
  const [members, memberships] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(
        and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.status, "active"))
      ),
    db
      .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        inArray(groupMembers.groupId, [
          ...ctx.groups.map((g) => g.id),
          NO_GROUP,
        ])
      ),
  ])
  const reached = members.filter((m) =>
    inAudience(
      memberships.filter((x) => x.userId === m.id).map((x) => x.groupId),
      audience,
      (id) => chainOf(ctx, id)
    )
  )
  return {
    count: reached.length,
    sample: reached.slice(0, 6).map((m) => m.name ?? m.email),
  }
}

/** Moves people sitting directly in a group into one of the last-level groups inside it. */
export async function placeInGroup(
  slug: string,
  user: User,
  groupId: string,
  into: string,
  userIds: string[]
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, groupId)
  need(ctx, "org.members.groups", groupId)
  if (!chainOf(ctx, into).includes(groupId) || into === groupId) {
    throw new ApiError(
      400,
      "not_inside",
      `Choose a group inside ${group.name}.`
    )
  }
  needLeaf(ctx, into)
  await getDb().transaction(async (tx) => {
    const waiting = (
      await tx
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            inArray(groupMembers.userId, userIds.length ? userIds : [NO_GROUP])
          )
        )
    ).map((r) => r.userId)
    if (waiting.length === 0) return
    await tx
      .insert(groupMembers)
      .values(waiting.map((userId) => ({ groupId: into, userId })))
      .onConflictDoNothing()
    for (const userId of waiting) await settleBelow(tx, ctx, userId, into)
    await audit(
      tx,
      ctx,
      "member.groups",
      `Placed ${waiting.length} ${waiting.length === 1 ? "person" : "people"} from ${group.name} into ${groupIn(ctx, into).name}`
    )
  })
}

/** Everyone in a group and the groups inside it. */
function insideIds(ctx: OrgContext, id: string) {
  return ctx.groups
    .filter((g) => chainOf(ctx, g.id).includes(id))
    .map((g) => g.id)
}

/** Takes everyone out of a group and the groups inside it; the groups stay. */
export async function emptyGroup(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  need(ctx, "org.members.groups", id)
  return getDb().transaction(async (tx) => {
    const removed = await tx
      .delete(groupMembers)
      .where(inArray(groupMembers.groupId, insideIds(ctx, id)))
      .returning({ userId: groupMembers.userId })
    const people = new Set(removed.map((r) => r.userId)).size
    await audit(
      tx,
      ctx,
      "member.groups",
      `Emptied ${group.name} (${people} ${people === 1 ? "person" : "people"})`
    )
    return { removed: people }
  })
}

/**
 * Moves everyone in a group (and the groups inside it) into another group, which as
 * always means its last-level groups. Used before deleting a group.
 */
export async function moveGroupPeople(
  slug: string,
  user: User,
  id: string,
  into: string,
  /** Only these people; everyone in the group when left out. */
  only?: string[]
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  const target = groupIn(ctx, into)
  need(ctx, "org.members.groups", id)
  need(ctx, "org.members.groups", into)
  const inside = insideIds(ctx, id)
  // Emptying a whole group (before deleting it) must send people outside it. Moving chosen
  // people can go anywhere else, like from Lab 1 to Lab 2 of the same section.
  if (into === id || (!only && inside.includes(into))) {
    throw new ApiError(
      400,
      "inside_itself",
      `Choose a group outside ${group.name}.`
    )
  }
  const targets = leavesUnder(ctx, into)
  return getDb().transaction(async (tx) => {
    const people = [
      ...new Set(
        (
          await tx
            .select({ userId: groupMembers.userId })
            .from(groupMembers)
            .where(inArray(groupMembers.groupId, inside))
        ).map((r) => r.userId)
      ),
    ].filter((userId) => !only || only.includes(userId))
    if (people.length) {
      // Out of where they were first, so a target inside the same group keeps them.
      await tx
        .delete(groupMembers)
        .where(
          and(
            inArray(groupMembers.groupId, inside),
            inArray(groupMembers.userId, people)
          )
        )
      await tx
        .insert(groupMembers)
        .values(
          targets.flatMap((t) =>
            people.map((userId) => ({ groupId: t, userId }))
          )
        )
        .onConflictDoNothing()
      for (const userId of people) {
        for (const t of targets) await settleBelow(tx, ctx, userId, t)
      }
    }
    await audit(
      tx,
      ctx,
      "member.groups",
      `Moved ${people.length} ${people.length === 1 ? "person" : "people"} from ${group.name} to ${target.name}`
    )
    return { moved: people.length }
  })
}
