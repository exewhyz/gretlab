import { z } from "zod"

/*
 * Profile forms, shared by the browser and the server (no server imports here).
 */

const optional = (max: number, message?: string) =>
  z.string().trim().max(max, message ?? `At most ${max} characters`).optional()

const link = z
  .string()
  .trim()
  .max(300)
  .refine(
    (v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v),
    "Enter a full address, like https://…"
  )
  .optional()

const phone = z
  .string()
  .trim()
  .max(30)
  .refine(
    (v) => v === "" || /^\+?[0-9 ()-]{6,}$/.test(v),
    "Use digits, spaces and +, like +91 98765 43210"
  )
  .optional()

export const accountProfileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120).optional(),
  /** Their public address, /u/<handle>. */
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9_-]{2,29}$/,
      "3 to 30 letters, digits, - or _, starting with a letter or digit"
    )
    .optional(),
  headline: optional(120),
  bio: optional(2000),
  city: optional(80),
  website: link,
  github: z
    .string()
    .trim()
    .max(39)
    .refine(
      (v) => v === "" || /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(v),
      "Just the GitHub username"
    )
    .optional(),
  linkedin: link,
  phone,
})

export type AccountProfileInput = z.infer<typeof accountProfileSchema>

export const memberProfileSchema = z.object({
  designation: optional(80),
  department: optional(80),
  employeeId: optional(40),
  joinedOn: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a date")
    .optional(),
  phone,
})

export type MemberProfileInput = z.infer<typeof memberProfileSchema>
