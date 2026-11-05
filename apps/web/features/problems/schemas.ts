import { z } from "zod"

/** A readable address from a title: "Midterm 2026!" becomes "midterm-2026". */
export function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
}

const slug = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,62}$/,
    "Use lowercase letters, numbers and dashes"
  )

export const problemInputSchema = z.object({
  slug,
  title: z.string().trim().min(1, "Give the problem a title").max(200),
  unitId: z.uuid().nullable(),
  level: z.enum(["easy", "medium", "hard"]),
  statement: z.array(z.union([z.string(), z.array(z.array(z.string()))])),
  inputFormat: z.array(z.string()),
  outputFormat: z.array(z.string()),
  constraints: z.array(z.string()),
  solution: z.string().max(100_000),
  membersOnly: z.boolean().default(false),
  editorial: z.string().max(100_000).default(""),
  hints: z.array(z.string().trim().min(1).max(2000)).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  timeLimitMs: z.number().int().min(100).max(60_000).nullable(),
  memoryLimitMb: z.number().int().min(32).max(4096).nullable(),
  allowedLanguages: z.array(z.string()).nullable(),
  published: z.boolean(),
  tests: z
    .array(
      z.object({
        input: z.string().max(1024 * 1024),
        expected: z.string().min(1, "Every test needs an expected output"),
        isSample: z.boolean(),
        points: z.number().int().min(0).max(1000),
      })
    )
    .min(1, "Add at least one test case")
    .refine((tests) => tests.some((test) => test.isSample), {
      message: "Mark at least one test as a sample so students see an example",
    }),
})

export type ProblemInput = z.infer<typeof problemInputSchema>

/** Conditions that must all hold, each met by any of its groups; empty for everyone. */
const audienceSchema = z
  .array(z.array(z.uuid()).min(1).max(50))
  .max(5, "At most 5 conditions")
  .default([])

export const contestInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the contest a title").max(200),
    slug,
    description: z.string().max(20_000),
    startsAt: z.coerce.date({ error: "Choose a start time" }),
    endsAt: z.coerce.date({ error: "Choose an end time" }),
    scoring: z.enum(["icpc", "ioi"]),
    penaltyMinutes: z
      .number({ error: "Enter a number of minutes" })
      .int()
      .min(0, "Can't be negative")
      .max(1440, "At most 1440 minutes"),
    freezeMinutes: z
      .number({ error: "Enter a number of minutes" })
      .int()
      .min(0, "Can't be negative")
      .max(100_000),
    published: z.boolean(),
    registrationOpen: z.boolean(),
    problemIds: z
      .array(z.uuid())
      .min(1, "Add at least one problem")
      .max(26, "At most 26 problems"),
    /** Organization groups it's for. Ignored for platform contests. */
    audience: audienceSchema,
  })
  .refine((contest) => contest.endsAt > contest.startsAt, {
    message: "The contest must end after it starts",
    path: ["endsAt"],
  })
  .refine(
    (contest) =>
      contest.freezeMinutes * 60_000 <
        contest.endsAt.getTime() - contest.startsAt.getTime() ||
      contest.freezeMinutes === 0,
    {
      message: "The freeze must be shorter than the contest",
      path: ["freezeMinutes"],
    }
  )

export type ContestInput = z.infer<typeof contestInputSchema>

export const assignmentInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the assignment a title").max(200),
    slug,
    description: z.string().max(20_000),
    opensAt: z.coerce.date({ error: "Choose when it opens" }),
    dueAt: z.coerce.date({ error: "Choose a due time" }),
    allowLate: z.boolean(),
    latePenaltyPercent: z
      .number({ error: "Enter a percentage" })
      .int()
      .min(0, "Can't be negative")
      .max(100, "At most 100%"),
    published: z.boolean(),
    problems: z
      .array(
        z.object({
          problemId: z.uuid(),
          points: z
            .number({ error: "Enter the points" })
            .int()
            .min(1, "At least 1 point")
            .max(1000, "At most 1000 points"),
        })
      )
      .min(1, "Add at least one problem")
      .max(50, "At most 50 problems")
      .refine(
        (items) => new Set(items.map((i) => i.problemId)).size === items.length,
        "A problem is listed twice"
      ),
    audience: audienceSchema,
  })
  .refine((a) => a.dueAt > a.opensAt, {
    message: "The due time must be after it opens",
    path: ["dueAt"],
  })

export type AssignmentInput = z.infer<typeof assignmentInputSchema>

export const submissionInputSchema = z.object({
  kind: z.enum(["run", "submit"]),
  language: z.string(),
  entry: z.string(),
  files: z.unknown(),
  stdin: z
    .string()
    .max(1024 * 1024)
    .optional(),
  /** The cases a Run should execute. */
  inputs: z
    .array(z.string().max(1024 * 1024))
    .max(10, "At most 10 test cases at a time")
    .optional(),
  problemSlug: z.string().optional(),
  contestSlug: z.string().optional(),
})
