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

export const moduleSchema = z.object({
  /** Kept for existing modules, so progress and links follow them. */
  id: z.uuid().optional(),
  title: z.string().trim().min(1, "Name every module").max(200),
  summary: z.string().max(2000).default(""),
  openAfterDays: z.number().int().min(0).max(730).nullable().default(null),
  afterPrevious: z.boolean().default(false),
  items: z.array(courseItemSchema).max(100, "At most 100 items in a module").default([]),
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
