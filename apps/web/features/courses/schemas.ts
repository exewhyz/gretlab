import { z } from "zod"

import { expectedUpdatedAt } from "@/lib/api/version"

/** Browser-safe: forms load this. */

export const courseSchema = z.object({
  expectedUpdatedAt,
  title: z.string().trim().min(1, "Name the course").max(200),
  description: z.string().max(5000).default(""),
  published: z.boolean().default(false),
})

export const courseItemSchema = z.object({
  kind: z.enum(["problem", "question"]),
  id: z.uuid(),
})

/**
 * A module's quiz (questions that mark themselves), lab (problems) or project (a GitHub
 * repository a teacher marks), at most one of each. Items carry their points.
 */
export const checkpointSchema = z
  .object({
    kind: z.enum(["quiz", "lab", "project"]),
    title: z
      .string()
      .trim()
      .min(1, "Name every quiz, lab and project")
      .max(200),
    instructions: z.string().max(20000).default(""),
    /** Minutes; null for no limit. Projects have none. */
    timeLimit: z
      .number()
      .int()
      .min(1, "A time limit is at least a minute")
      .max(600)
      .nullable()
      .default(null),
    weight: z.number().int().min(0).max(100).default(1),
    /** A project's mark is out of this. */
    points: z.number().int().min(1).max(1000).default(100),
    items: z
      .array(
        z.object({ id: z.uuid(), points: z.number().int().min(1).max(1000) })
      )
      .max(50, "At most 50 in a quiz or lab")
      .default([]),
  })
  .refine((c) => c.kind === "project" || c.items.length > 0, {
    message: "A quiz needs questions and a lab needs problems",
    path: ["items"],
  })

export const moduleSchema = z.object({
  /** Kept for existing modules, so progress and links follow them. */
  id: z.uuid().optional(),
  title: z.string().trim().min(1, "Name every module").max(200),
  summary: z.string().max(2000).default(""),
  openAfterDays: z.number().int().min(0).max(730).nullable().default(null),
  afterPrevious: z.boolean().default(false),
  items: z
    .array(courseItemSchema)
    .max(100, "At most 100 items in a module")
    .default([]),
  checkpoints: z
    .array(checkpointSchema)
    .max(3)
    .default([])
    .refine(
      (list) => new Set(list.map((c) => c.kind)).size === list.length,
      "One quiz, lab and project at most per module"
    ),
})

export const outlineSchema = z.object({
  expectedUpdatedAt,
  modules: z.array(moduleSchema).max(60, "At most 60 modules"),
})

export const classCourseSchema = z.object({
  courseId: z.uuid(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the start day"),
})

export const practiceAnswerSchema = z.object({
  questionId: z.uuid(),
  answer: z.union([z.array(z.string().max(20)).max(10), z.string().max(500)]),
})

export type CourseInput = z.infer<typeof courseSchema>
export type OutlineInput = z.infer<typeof outlineSchema>

export const quizAnswersSchema = z.object({
  answers: z.record(
    z.uuid(),
    z.union([z.array(z.string().max(20)).max(10), z.string().max(5000)])
  ),
})

export const projectHandInSchema = z.object({
  repoUrl: z.string().trim().min(1, "Paste your repository's link").max(500),
  note: z.string().max(2000).default(""),
})

export const projectMarkSchema = z.object({
  /** Null takes the mark away. */
  mark: z.number().int().min(0).nullable(),
  feedback: z.string().max(5000).default(""),
})

export type CheckpointInput = z.infer<typeof checkpointSchema>
