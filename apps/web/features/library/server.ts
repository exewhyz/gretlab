import {
  collectionItems,
  collections,
  contentShares,
  courses,
  templates,
  getDb,
  organizations,
  problems,
  problemTags,
  questions,
  sql,
  tags,
  testCases,
  users,
  type Sharing,
  type User,
} from "@workspace/db"

import { ApiError, notFound } from "@/lib/api/route"
import { saveProblem } from "@/features/problems/server"

import { sourceOf, usableBy, usableIds, type ShareKind } from "./sharing"

const tableOf = (kind: ShareKind) =>
  kind === "problem" ? problems : kind === "question" ? questions : kind === "course" ? courses : templates

/*
 * The library: one place for an owner's content (the platform's, or one college's) and
 * what's shared with it. `orgId` is the owner, already authorized by the caller.
 */

const { and, asc, eq, inArray, isNull } = sql

type Kind = "problem" | "question"

const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(collections.orgId) : eq(collections.orgId, orgId)

export async function getLibrary(orgId: string | null, userId?: string) {
  const db = getDb()
  const [problemRows, questionRows, cols, members, shares, orgNames] = await Promise.all([
    db
      .select({
        id: problems.id,
        slug: problems.slug,
        title: problems.title,
        level: problems.level,
        published: problems.published,
        listed: problems.listed,
        sharing: problems.sharing,
        orgId: problems.orgId,
        copiedFrom: problems.copiedFrom,
        updatedAt: problems.updatedAt,
      })
      .from(problems)
      .where(usableBy(problems, "problem", orgId, userId))
      .orderBy(asc(problems.title)),
    db
      .select({
        id: questions.id,
        title: questions.title,
        kind: questions.kind,
        points: questions.points,
        tags: questions.tags,
        accepted: questions.accepted,
        published: questions.published,
        sharing: questions.sharing,
        orgId: questions.orgId,
        copiedFrom: questions.copiedFrom,
        updatedAt: questions.updatedAt,
      })
      .from(questions)
      .where(usableBy(questions, "question", orgId, userId))
      .orderBy(asc(questions.title)),
    db.select().from(collections).where(ownedBy(orgId)).orderBy(asc(collections.name)),
    db
      .select()
      .from(collectionItems)
      .innerJoin(collections, eq(collectionItems.collectionId, collections.id))
      .where(ownedBy(orgId)),
    db.select().from(contentShares),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
  ])
  const tagRows = await db
    .select({ problemId: problemTags.problemId, name: tags.name })
    .from(problemTags)
    .innerJoin(tags, eq(problemTags.tagId, tags.id))
  const nameOf = (id: string | null) =>
    id === null ? "Platform" : (orgNames.find((o) => o.id === id)?.name ?? "A college")
  const inCollections = (kind: Kind, id: string) =>
    members
      .filter((m) => m.collection_items.itemType === kind && m.collection_items.itemId === id)
      .map((m) => m.collection_items.collectionId)
  const sharedWith = (kind: Kind, id: string) =>
    shares.filter((s) => s.itemType === kind && s.itemId === id).length
  return {
    collections: cols.map((c) => ({
      ...c,
      size: members.filter((m) => m.collection_items.collectionId === c.id).length,
    })),
    problems: problemRows.map((p) => ({
      ...p,
      kind: "problem" as const,
      source: sourceOf(p.orgId, orgId),
      owner: nameOf(p.orgId),
      tags: tagRows.filter((t) => t.problemId === p.id).map((t) => t.name),
      collections: inCollections("problem", p.id),
      sharedWith: sharedWith("problem", p.id),
    })),
    questions: questionRows.map(({ accepted, ...q }) => ({
      ...q,
      marksItself:
        q.kind === "single" || q.kind === "multiple" || (q.kind === "short" && accepted.length > 0),
      source: sourceOf(q.orgId, orgId),
      owner: nameOf(q.orgId),
      collections: inCollections("question", q.id),
      sharedWith: sharedWith("question", q.id),
    })),
  }
}

/* ---------- collections ---------- */

async function collectionOf(orgId: string | null, id: string) {
  const [row] = await getDb()
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), ownedBy(orgId)))
  if (!row) throw notFound("Collection not found")
  return row
}

export async function saveCollection(
  orgId: string | null,
  id: string | null,
  input: { name: string; description: string }
) {
  if (id) {
    await collectionOf(orgId, id)
    const [row] = await getDb().update(collections).set(input).where(eq(collections.id, id)).returning()
    return row!
  }
  const [row] = await getDb().insert(collections).values({ ...input, orgId }).returning()
  return row!
}

export async function deleteCollection(orgId: string | null, id: string) {
  await collectionOf(orgId, id)
  // The items stay in the library; only the folder goes.
  await getDb().delete(collections).where(eq(collections.id, id))
}

/** Adds items to a collection, or takes them out. Only items the owner can use. */
export async function changeCollection(
  orgId: string | null,
  id: string,
  input: { add?: { kind: Kind; id: string }[]; remove?: { kind: Kind; id: string }[] },
  userId?: string
) {
  await collectionOf(orgId, id)
  const db = getDb()
  for (const kind of ["problem", "question"] as const) {
    const adding = (input.add ?? []).filter((i) => i.kind === kind).map((i) => i.id)
    const usable = await usableIds(kind, adding, orgId, userId)
    if (adding.some((x) => !usable.has(x))) {
      throw new ApiError(400, "not_shared", "Only content you can use goes in your collections.")
    }
    if (adding.length) {
      await db
        .insert(collectionItems)
        .values(adding.map((itemId) => ({ collectionId: id, itemType: kind, itemId })))
        .onConflictDoNothing()
    }
    const removing = (input.remove ?? []).filter((i) => i.kind === kind).map((i) => i.id)
    if (removing.length) {
      await db
        .delete(collectionItems)
        .where(
          and(
            eq(collectionItems.collectionId, id),
            eq(collectionItems.itemType, kind),
            inArray(collectionItems.itemId, removing)
          )
        )
    }
  }
}

/* ---------- sharing (the platform's content) ---------- */

/** Who an item reaches: everyone, chosen colleges and teachers, or the owner only. */
export async function getSharing(kind: ShareKind, id: string) {
  const rows = await getDb()
    .select({ orgId: contentShares.orgId, userId: contentShares.userId, email: users.email })
    .from(contentShares)
    .leftJoin(users, eq(contentShares.userId, users.id))
    .where(and(eq(contentShares.itemType, kind), eq(contentShares.itemId, id)))
  return {
    orgIds: rows.flatMap((r) => (r.orgId ? [r.orgId] : [])),
    emails: rows.flatMap((r) => (r.email ? [r.email] : [])),
  }
}

/**
 * Sets how far some of the platform's items reach. `selected` takes the colleges and
 * teachers given; the others clear them.
 */
export async function setSharing(
  actor: User,
  items: { kind: ShareKind; id: string }[],
  input: { sharing: Sharing; orgIds: string[]; emails: string[] }
) {
  const db = getDb()
  for (const kind of ["problem", "question", "course", "template"] as const) {
    const ids = items.filter((i) => i.kind === kind).map((i) => i.id)
    if (ids.length === 0) continue
    const table = tableOf(kind)
    const own = await db
      .select({ id: table.id })
      .from(table)
      .where(and(inArray(table.id, ids), isNull(table.orgId)))
    if (own.length !== ids.length) {
      throw new ApiError(400, "not_platform", "Only the platform's own content is shared from here.")
    }
  }
  const people = input.emails.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, input.emails.map((e) => e.toLowerCase())))
    : []
  const missing = input.emails.filter((e) => !people.some((p) => p.email === e.toLowerCase()))
  if (missing.length) {
    throw new ApiError(400, "unknown_person", `No account for ${missing.join(", ")}.`)
  }
  await db.transaction(async (tx) => {
    for (const item of items) {
      const table = tableOf(item.kind)
      // Who it reaches isn't an edit: open editors keep their version.
      await tx
        .update(table)
        .set({ sharing: input.sharing, updatedAt: sql.sql`${table.updatedAt}` })
        .where(eq(table.id, item.id))
      await tx
        .delete(contentShares)
        .where(and(eq(contentShares.itemType, item.kind), eq(contentShares.itemId, item.id)))
      if (input.sharing !== "selected") continue
      const rows = [
        ...input.orgIds.map((orgId) => ({ orgId, userId: null })),
        ...people.map((p) => ({ orgId: null, userId: p.id })),
      ]
      if (rows.length) {
        await tx.insert(contentShares).values(
          rows.map((r) => ({ ...r, itemType: item.kind, itemId: item.id, createdBy: actor.id }))
        )
      }
    }
  })
}

/* ---------- copying into a college's library ---------- */

/**
 * A college's own copy of an item it can use, to adapt. The copy remembers where it came
 * from, stays the college's (not shared), and starts as a draft for problems.
 */
export async function copyToLibrary(
  orgId: string,
  items: { kind: Kind; id: string }[],
  userId?: string
) {
  const db = getDb()
  const created: { kind: Kind; id: string; title: string }[] = []
  for (const item of items) {
    const usable = await usableIds(item.kind, [item.id], orgId, userId)
    if (!usable.has(item.id)) throw notFound("Not found")
    if (item.kind === "question") {
      const [q] = await db.select().from(questions).where(eq(questions.id, item.id))
      if (!q || q.orgId === orgId) continue
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = q
      const [copy] = await db
        .insert(questions)
        .values({ ...rest, orgId, sharing: "owner", copiedFrom: q.id })
        .returning()
      created.push({ kind: "question", id: copy!.id, title: copy!.title })
      continue
    }
    const [p] = await db.select().from(problems).where(eq(problems.id, item.id))
    if (!p || p.orgId === orgId) continue
    const [tests, tagNames, taken] = await Promise.all([
      db.select().from(testCases).where(eq(testCases.problemId, p.id)).orderBy(asc(testCases.position)),
      db
        .select({ name: tags.name })
        .from(problemTags)
        .innerJoin(tags, eq(problemTags.tagId, tags.id))
        .where(eq(problemTags.problemId, p.id)),
      db.select({ slug: problems.slug }).from(problems).where(sql.like(problems.slug, `${p.slug}%`)),
    ])
    const used = new Set(taken.map((t) => t.slug))
    let slug = `${p.slug}-copy`.slice(0, 60)
    for (let n = 2; used.has(slug); n++) slug = `${p.slug.slice(0, 54)}-copy-${n}`
    const saved = await saveProblem(
      null,
      {
        slug,
        title: p.title,
        unitId: null,
        level: p.level,
        description: p.description,
        statement: [],
        inputFormat: p.inputFormat,
        outputFormat: p.outputFormat,
        constraints: p.constraints,
        solution: p.solution,
        code: p.code,
        editorial: p.editorial,
        hints: p.hints,
        tags: tagNames.map((t) => t.name),
        timeLimitMs: p.timeLimitMs,
        memoryLimitMb: p.memoryLimitMb,
        allowedLanguages: p.allowedLanguages,
        published: false,
        membersOnly: false,
        listed: p.listed,
        tests: tests.map((t) => ({
          input: t.input,
          expected: t.expected,
          isSample: t.isSample,
          points: t.points,
        })),
      },
      orgId
    )
    await db
      .update(problems)
      .set({ sharing: "owner", copiedFrom: p.id })
      .where(eq(problems.id, saved.id))
    created.push({ kind: "problem", id: saved.id, title: saved.title })
  }
  return { created }
}
