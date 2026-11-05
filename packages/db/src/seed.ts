/**
 * Imports questions from the original content.json. Safe to re-run: existing problems
 * (matched by slug) are left alone, so dashboard edits are never overwritten.
 */
import { readFileSync } from "node:fs"

import { eq, sql } from "drizzle-orm"

import { getDb, problems, tags, testCases, units } from "./index.ts"

interface RawQuestion {
  id: string
  title: string
  level: "easy" | "medium" | "hard"
  statement: (string | string[][])[]
  input: string[]
  output: string[]
  constraints: string[]
  samples: [string, string][]
  tests: [string, string][]
  solution: string
}

const path =
  process.argv[2] ??
  new URL("../seed-data/content.json", import.meta.url).pathname
const content = JSON.parse(readFileSync(path, "utf8")) as {
  units: { name: string; questions: RawQuestion[] }[]
}

const db = getDb()
let added = 0

for (const [unitIndex, unit] of content.units.entries()) {
  const [existing] = await db
    .select()
    .from(units)
    .where(eq(units.name, unit.name))
  const unitRow =
    existing ??
    (
      await db
        .insert(units)
        .values({ name: unit.name, position: unitIndex })
        .returning()
    )[0]
  if (!unitRow) throw new Error(`Could not create unit ${unit.name}`)

  for (const [position, question] of unit.questions.entries()) {
    const [problem] = await db
      .insert(problems)
      .values({
        slug: question.id,
        unitId: unitRow.id,
        position,
        title: question.title,
        level: question.level,
        statement: question.statement,
        inputFormat: question.input,
        outputFormat: question.output,
        constraints: question.constraints,
        solution: question.solution,
      })
      .onConflictDoNothing({ target: problems.slug })
      .returning()
    if (!problem) continue
    added += 1
    const cases = [
      ...question.samples.map(([input, expected]) => ({
        input,
        expected,
        isSample: true,
      })),
      ...question.tests.map(([input, expected]) => ({
        input,
        expected,
        isSample: false,
      })),
    ]
    if (cases.length) {
      await db.insert(testCases).values(
        cases.map((testCase, index) => ({
          ...testCase,
          problemId: problem.id,
          position: index,
        }))
      )
    }
  }
}

// Each unit becomes a topic tag for its problems that have none yet.
for (const unit of content.units) {
  const slug = unit.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const [tag] = await db
    .insert(tags)
    .values({ slug, name: unit.name })
    .onConflictDoUpdate({ target: tags.slug, set: { name: unit.name } })
    .returning()
  if (!tag) continue
  await db.execute(sql`
    INSERT INTO problem_tags (problem_id, tag_id)
    SELECT p.id, ${tag.id} FROM problems p
    WHERE p.slug IN (${sql.join(
      unit.questions.map((q) => sql`${q.id}`),
      sql`, `
    )})
      AND NOT EXISTS (SELECT 1 FROM problem_tags pt WHERE pt.problem_id = p.id)
  `)
}

console.log(`Seeded ${added} new problems`)
process.exit(0)
