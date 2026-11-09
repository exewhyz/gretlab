import { LANGUAGES } from "@workspace/judge"
import { z } from "zod"

import { problemInputSchema, slugify, type ProblemInput } from "./schemas"

/*
 * The problem file: one format for every import (the problem library, and problems
 * written for an assignment, exam or contest). Documented in docs/problem-format.md, with
 * a template served at /problem-template.json. Friendly names, close to how a teacher
 * thinks of a problem; turned into the editor's ProblemInput here.
 */

const text = (max: number) => z.string().max(max)
const lines = z
  .union([z.string(), z.array(z.string().max(2000))])
  .transform((v) => (typeof v === "string" ? v.split("\n") : v))
  .transform((v) => v.map((line) => line.trim()).filter(Boolean))
  .default([])

const caseSchema = z.object({
  input: text(1024 * 1024).default(""),
  output: text(1024 * 1024),
  points: z.number().int().min(0).max(1000).optional(),
})

export const importedProblemSchema = z.object({
  title: z.string().trim().min(1, "Give the problem a title").max(200),
  /** Optional: made from the title, and made unique if taken. */
  slug: z.string().trim().optional(),
  level: z.enum(["easy", "medium", "hard"]).default("easy"),
  /** The statement in markdown. */
  statement: text(200_000).min(1, "Write the statement"),
  input: lines,
  output: lines,
  constraints: lines,
  /** Shown to students as examples; graded too. */
  samples: z.array(caseSchema).min(1, "Give at least one sample"),
  /** Hidden tests. */
  tests: z.array(caseSchema).default([]),
  /** Per language: starter code and reference solution. */
  code: z
    .record(
      z.string().refine((id) => id in LANGUAGES, "Unknown language"),
      z.object({
        starter: text(100_000).optional(),
        solution: text(100_000).optional(),
      })
    )
    .default({}),
  hints: z.array(z.string().trim().min(1).max(2000)).max(10).default([]),
  editorial: text(100_000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  timeLimitMs: z.number().int().min(100).max(60_000).nullable().default(null),
  memoryLimitMb: z.number().int().min(32).max(4096).nullable().default(null),
  /** Languages students may use; null or missing for all. */
  languages: z.array(z.string()).nullable().default(null),
})

export type ImportedProblem = z.infer<typeof importedProblemSchema>

/** The whole file: `{ "format": "gretlab-problems", "version": 1, "problems": [...] }`, a bare list, or one problem. */
export const problemFileSchema = z
  .union([
    z.object({
      format: z.literal("gretlab-problems").optional(),
      version: z.literal(1).optional(),
      problems: z.array(z.unknown()),
    }),
    z.array(z.unknown()),
    z.record(z.string(), z.unknown()),
  ])
  .transform((file) =>
    Array.isArray(file)
      ? file
      : "problems" in file && Array.isArray(file.problems)
        ? file.problems
        : [file]
  )

export const importRequestSchema = z.object({
  file: z.unknown(),
  /** In the problem library, or only for assignments, exams and contests. */
  listed: z.boolean().default(true),
  /** Ready for students; otherwise imported as drafts. */
  published: z.boolean().default(false),
})

/** An imported problem as the editor would save it. */
export function toProblemInput(
  p: ImportedProblem,
  slug: string,
  options: { listed: boolean; published: boolean }
): ProblemInput {
  const cases = [
    ...p.samples.map((c) => ({ ...c, isSample: true })),
    ...p.tests.map((c) => ({ ...c, isSample: false })),
  ]
  return problemInputSchema.parse({
    slug,
    title: p.title,
    unitId: null,
    level: p.level,
    description: p.statement,
    inputFormat: p.input,
    outputFormat: p.output,
    constraints: p.constraints,
    code: p.code,
    editorial: p.editorial,
    hints: p.hints,
    tags: p.tags,
    timeLimitMs: p.timeLimitMs,
    memoryLimitMb: p.memoryLimitMb,
    allowedLanguages: p.languages,
    published: options.published,
    listed: options.listed,
    membersOnly: false,
    tests: cases.map((c) => ({
      input: c.input,
      expected: c.output.replace(/\n+$/, ""),
      isSample: c.isSample,
      points: c.points ?? 1,
    })),
  })
}

/** Problems in a file, each checked; errors name the problem and the field. */
export function readProblemFile(raw: unknown) {
  const list = problemFileSchema.safeParse(raw)
  if (!list.success) {
    return { problems: [], errors: ["The file isn't a problem file. See the template."] }
  }
  const problems: ImportedProblem[] = []
  const errors: string[] = []
  if (list.data.length === 0) errors.push("The file has no problems.")
  if (list.data.length > 100) errors.push("At most 100 problems per file.")
  list.data.slice(0, 100).forEach((item, index) => {
    const parsed = importedProblemSchema.safeParse(item)
    if (parsed.success) return void problems.push(parsed.data)
    const title =
      item && typeof item === "object" && "title" in item ? String(item.title) : ""
    const issue = parsed.error.issues[0]!
    errors.push(
      `Problem ${index + 1}${title ? ` (${title})` : ""}: ${issue.path.join(".") || "it"}: ${issue.message}`
    )
  })
  return { problems, errors }
}

export const slugFor = (p: ImportedProblem) => slugify(p.slug || p.title) || "problem"
