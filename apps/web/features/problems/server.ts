import {
  contestProblems,
  contests,
  getDb,
  notes,
  problems,
  sql,
  problemTags,
  tags,
  testCases,
  units,
  type Problem,
} from "@workspace/db"
import {
  LANGUAGE_IDS,
  joinStarter,
  LANGUAGES,
  statementToMarkdown,
  type ProblemCode,
} from "@workspace/judge"
import { revalidatePath } from "next/cache"

import { ApiError, notFound } from "@/lib/api/route"
import {
  getProblemTagNames,
  refreshCatalog,
  setProblemTags,
} from "@/features/catalog/server"

import type { ProblemInput } from "./schemas"
import { readProblemFile, slugFor, toProblemInput } from "./import"
import { editedElsewhere, unchangedSince } from "@/lib/api/conflict"

const { and, asc, count, eq, gt, inArray, isNull, lte, or } = sql

export interface ProblemSummary {
  id: string
  title: string
  level: string
  unit: string
  unitNo: number
  no: number
  label: string
}

/** What any visitor may see. Hidden tests and the solution are deliberately absent. */
export interface ProblemDetail extends ProblemSummary {
  /** The statement in markdown; input and output format and constraints are separate. */
  description: string
  statement: (string | string[][])[]
  input: string[]
  output: string[]
  constraints: string[]
  samples: [string, string][]
  hiddenTestCount: number
  allowedLanguages: string[] | null
  hasSolution: boolean
  /** Starter code by language, where the problem sets its own. */
  starters: Record<string, string>
  /** The organization running this contest turned pasting off. */
  pasteBlocked?: boolean
  hints: string[]
  tags: { slug: string; name: string }[]
  notes: { id: string; text: string }[]
}

/** Problems anyone may see: published, and not kept for an organization's members. */
export const isPublicProblem = and(
  eq(problems.published, true),
  eq(problems.membersOnly, false),
  eq(problems.listed, true)
)!

async function numbered(where = isPublicProblem) {
  const rows = await getDb()
    .select({ problem: problems, unit: units })
    .from(problems)
    .leftJoin(units, eq(problems.unitId, units.id))
    .where(where)
    .orderBy(asc(units.position), asc(problems.position), asc(problems.slug))

  const unitOrder = [...new Set(rows.map((row) => row.unit?.id ?? null))]
  return rows.map(({ problem, unit }, index) => ({
    problem,
    summary: {
      id: problem.slug,
      title: problem.title,
      level: problem.level,
      unit: unit?.name ?? "Questions",
      unitNo: unitOrder.indexOf(unit?.id ?? null) + 1,
      no: index + 1,
      label: `P${index + 1}`,
    } satisfies ProblemSummary,
  }))
}

export async function listPublicProblems(): Promise<ProblemSummary[]> {
  return (await numbered()).map((row) => row.summary)
}

/**
 * The stored code and the Python solution column, kept in step. Older callers send only
 * `solution`, which is Python; empty parts are dropped.
 */
function problemCode(
  code: Record<string, ProblemCode>,
  legacySolution: string
): { code: Record<string, ProblemCode>; solution: string } {
  // Older callers may send a separate driver; it becomes part of the starter.
  const merged: Record<string, ProblemCode> = Object.fromEntries(
    Object.entries(code).map(([id, parts]) => [
      id,
      { starter: joinStarter(parts), solution: parts.solution },
    ])
  )
  if (legacySolution.trim() && !merged.python?.solution?.trim()) {
    merged.python = { ...merged.python, solution: legacySolution }
  }
  const cleaned = Object.fromEntries(
    Object.entries(merged)
      .map(([id, parts]) => [
        id,
        Object.fromEntries(
          Object.entries(parts).filter(
            ([, text]) => typeof text === "string" && text.trim()
          )
        ) as ProblemCode,
      ])
      .filter(([, parts]) => Object.keys(parts as ProblemCode).length > 0)
  )
  return { code: cleaned, solution: cleaned.python?.solution ?? "" }
}

/** Reference solutions by language, for the editorial: never part of public page data. */
export function referenceSolutions(problem: Problem) {
  // Rows from before per-language code have only the Python solution column.
  const code =
    problem.solution.trim() && !problem.code.python?.solution?.trim()
      ? {
          ...problem.code,
          python: { ...problem.code.python, solution: problem.solution },
        }
      : problem.code
  // In the order languages are offered: Python first.
  return LANGUAGE_IDS.map((id) => [id, code[id]] as const)
    .filter(([, parts]) => parts?.solution?.trim())
    .map(([id, parts]) => ({
      language: id,
      label: LANGUAGES[id].label,
      code: parts!.solution!,
    }))
}

/** Each language's starter code, with any older driver code folded in. */
const starters = (problem: Problem) =>
  Object.fromEntries(
    Object.entries(problem.code)
      .map(([id, parts]) => [id, joinStarter(parts)] as const)
      .filter(([, starter]) => starter?.trim())
  ) as Record<string, string>

export async function buildDetail(
  problem: Problem,
  summary: ProblemSummary
): Promise<ProblemDetail> {
  const db = getDb()
  const [tests, problemNotes, tagRows] = await Promise.all([
    db
      .select({
        input: testCases.input,
        expected: testCases.expected,
        isSample: testCases.isSample,
      })
      .from(testCases)
      .where(eq(testCases.problemId, problem.id))
      .orderBy(asc(testCases.position)),
    db
      .select({ id: notes.id, text: notes.text })
      .from(notes)
      .where(and(eq(notes.problemId, problem.id), isNull(notes.orgId))),
    db
      .select({ slug: tags.slug, name: tags.name })
      .from(problemTags)
      .innerJoin(tags, eq(problemTags.tagId, tags.id))
      .where(eq(problemTags.problemId, problem.id))
      .orderBy(asc(tags.name)),
  ])
  return {
    ...summary,
    description: problem.description || statementToMarkdown(problem.statement),
    statement: problem.statement,
    input: problem.inputFormat,
    output: problem.outputFormat,
    constraints: problem.constraints,
    samples: tests
      .filter((test) => test.isSample)
      .map((test) => [test.input, test.expected]),
    hiddenTestCount: tests.filter((test) => !test.isSample).length,
    allowedLanguages: problem.allowedLanguages,
    hasSolution:
      problem.editorial.length > 0 || referenceSolutions(problem).length > 0,
    // Starter code is part of the problem, not its answer.
    starters: starters(problem),
    hints: problem.hints,
    tags: tagRows,
    notes: problemNotes,
  }
}

export async function getPublicProblem(
  slug: string
): Promise<ProblemDetail | null> {
  const row = (await numbered()).find((item) => item.problem.slug === slug)
  return row ? buildDetail(row.problem, row.summary) : null
}

export async function getGeneralNotices() {
  return (
    getDb()
      .select({ id: notes.id, text: notes.text, createdAt: notes.createdAt })
      .from(notes)
      // Organization notices are for their members only, never on public pages.
      .where(and(isNull(notes.problemId), isNull(notes.orgId)))
      .orderBy(asc(notes.createdAt))
  )
}

/** Solutions stay hidden while any live contest uses the problem. */
export async function isInLiveContest(problemId: string): Promise<boolean> {
  const now = new Date()
  const [row] = await getDb()
    .select({ total: count() })
    .from(contestProblems)
    .innerJoin(contests, eq(contestProblems.contestId, contests.id))
    .where(
      and(
        eq(contestProblems.problemId, problemId),
        lte(contests.startsAt, now),
        gt(contests.endsAt, now)
      )
    )
  return (row?.total ?? 0) > 0
}

export async function getProblemBySlug(slug: string) {
  const [problem] = await getDb()
    .select()
    .from(problems)
    .where(eq(problems.slug, slug))
  return problem ?? null
}

/* ---------- staff ---------- */

function refreshPublicPages(slug?: string) {
  // Public pages are cached; refresh them now rather than at the next timed revalidate.
  revalidatePath("/problems", "layout")
}

// `orgId` is the owner, already authorized by the caller: null for the platform's
// problems, or an organization's. Every query matches it.
const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(problems.orgId) : eq(problems.orgId, orgId)

/**
 * An owner's problems, for its problem list. With `picker`, also everyone's published
 * problems, which is what contests and assignments may use.
 */
export async function listProblemsForStaff(
  orgId: string | null,
  picker = false
) {
  const db = getDb()
  const [rows, unitRows, testCounts] = await Promise.all([
    db
      .select()
      .from(problems)
      .where(picker ? or(ownedBy(orgId), isPublicProblem) : ownedBy(orgId))
      .orderBy(asc(problems.position), asc(problems.slug)),
    db.select().from(units).orderBy(asc(units.position)),
    db
      .select({ problemId: testCases.problemId, total: count() })
      .from(testCases)
      .groupBy(testCases.problemId),
  ])
  return {
    units: unitRows,
    problems: rows.map(
      ({ solution: _solution, statement: _s, ...problem }) => ({
        ...problem,
        testCount:
          testCounts.find((item) => item.problemId === problem.id)?.total ?? 0,
      })
    ),
  }
}

export async function getProblemForStaff(id: string, orgId: string | null) {
  const db = getDb()
  const [problem] = await db
    .select()
    .from(problems)
    .where(and(eq(problems.id, id), ownedBy(orgId)))
  if (!problem) throw notFound("Problem not found")
  const tests = await db
    .select()
    .from(testCases)
    .where(eq(testCases.problemId, id))
    .orderBy(asc(testCases.position))
  return { ...problem, tests, tags: await getProblemTagNames(id) }
}

export async function saveProblem(
  id: string | null,
  input: ProblemInput,
  orgId: string | null
) {
  const { tests, tags: tagNames, expectedUpdatedAt, ...given } = input
  const fields = {
    ...given,
    ...problemCode(given.code, given.solution),
    // Written as markdown, or made from the older statement blocks.
    description:
      given.description.trim() || statementToMarkdown(given.statement),
    // The markdown replaces the blocks.
    statement: [],
  }
  if (!fields.description.trim()) {
    throw new ApiError(400, "no_description", "Describe the problem first.")
  }
  // Units are the platform's course outline; organizations' problems stand alone.
  const values = { ...fields, orgId, unitId: orgId ? null : fields.unitId }
  const saved = await getDb().transaction(async (tx) => {
    const [row] = id
      ? await tx
          .update(problems)
          .set(values)
          .where(
            and(
              eq(problems.id, id),
              ownedBy(orgId),
              unchangedSince(problems.updatedAt, expectedUpdatedAt)
            )
          )
          .returning()
      : await tx.insert(problems).values(values).returning()
    if (!row) {
      const [exists] = id
        ? await tx
            .select({ id: problems.id })
            .from(problems)
            .where(and(eq(problems.id, id), ownedBy(orgId)))
        : []
      throw exists ? editedElsewhere() : notFound("Problem not found")
    }
    await tx.delete(testCases).where(eq(testCases.problemId, row.id))
    await tx.insert(testCases).values(
      tests.map((test, position) => ({
        ...test,
        problemId: row.id,
        position,
      }))
    )
    return row
  })
  await setProblemTags(saved.id, tagNames)
  refreshCatalog()
  refreshPublicPages(saved.slug)
  return saved
}

export async function deleteProblem(id: string, orgId: string | null) {
  const [row] = await getDb()
    .delete(problems)
    .where(and(eq(problems.id, id), ownedBy(orgId)))
    .returning({ slug: problems.slug })
  if (!row) throw notFound("Problem not found")
  refreshPublicPages(row.slug)
}

export async function createUnit(name: string) {
  const [last] = await getDb()
    .select({ position: units.position })
    .from(units)
    .orderBy(sql.desc(units.position))
    .limit(1)
  const [unit] = await getDb()
    .insert(units)
    .values({ name, position: (last?.position ?? -1) + 1 })
    .returning()
  return unit
}

export async function listNotes(orgId: string | null) {
  return getDb()
    .select()
    .from(notes)
    .where(orgId === null ? isNull(notes.orgId) : eq(notes.orgId, orgId))
    .orderBy(sql.desc(notes.createdAt))
}

export async function addNote(
  text: string,
  problemId: string | null,
  orgId: string | null
) {
  const [note] = await getDb()
    .insert(notes)
    // Organization notices go on the organization's page, not on a problem.
    .values({ text, problemId: orgId ? null : problemId, orgId })
    .returning()
  if (!orgId) refreshPublicPages()
  return note
}

export async function deleteNote(id: string, orgId: string | null) {
  const deleted = await getDb()
    .delete(notes)
    .where(
      and(
        eq(notes.id, id),
        orgId === null ? isNull(notes.orgId) : eq(notes.orgId, orgId)
      )
    )
    .returning({ id: notes.id })
  if (deleted.length === 0) throw notFound("Notice not found")
  if (!orgId) refreshPublicPages()
}

export async function problemsByIds(ids: string[]) {
  return ids.length
    ? getDb().select().from(problems).where(inArray(problems.id, ids))
    : []
}

/**
 * Problems from a problem file (features/problems/import.ts), saved for this owner. Every
 * problem is checked before any is saved; addresses that are taken get a number added.
 */
export async function importProblems(
  orgId: string | null,
  raw: unknown,
  options: { listed: boolean; published: boolean }
) {
  const { problems: found, errors } = readProblemFile(raw)
  if (errors.length) {
    throw new ApiError(400, "invalid_file", errors.slice(0, 5).join(" "))
  }
  const wanted = found.map(slugFor)
  const taken = new Set(
    (
      await getDb()
        .select({ slug: problems.slug })
        .from(problems)
        .where(
          or(...wanted.map((s) => sql.like(problems.slug, `${s}%`)))
        )
    ).map((r) => r.slug)
  )
  const inputs = found.map((p, index) => {
    const base = wanted[index]!.slice(0, 56)
    let slug = base
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
    taken.add(slug)
    try {
      return toProblemInput(p, slug, options)
    } catch (error) {
      const issue = error instanceof Error ? error.message : "invalid"
      throw new ApiError(400, "invalid_file", `Problem ${index + 1} (${p.title}): ${issue}`)
    }
  })
  const created: { id: string; title: string; slug: string }[] = []
  for (const input of inputs) {
    const saved = await saveProblem(null, input, orgId)
    created.push({ id: saved.id, title: saved.title, slug: saved.slug })
  }
  return { created }
}
