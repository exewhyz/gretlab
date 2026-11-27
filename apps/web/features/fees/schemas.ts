import { z } from "zod"

import { expectedUpdatedAt } from "@/lib/api/version"

/* Shapes shared by the Fees screens and the server (browser-safe: zod only). */

export const feeHeadSchema = z.object({
  name: z.string().trim().min(1, "Give the fee head a name").max(80),
  gstRate: z.number().int().min(0).max(28),
  appliesTo: z.enum(["everyone", "hostel", "transport"]),
})

const instalmentSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().max(60),
  dueOn: z.string(),
  lines: z
    .array(
      z.object({
        headId: z.uuid(),
        amount: z.number().int().min(0).max(10_000_000),
      })
    )
    .max(40),
  fine: z
    .object({
      amount: z.number().int().min(0).max(1_000_000),
      graceDays: z.number().int().min(0).max(365),
    })
    .nullable(),
})

export const feePlanSchema = z.object({
  yearId: z.uuid(),
  name: z.string().trim().min(1, "Give the plan a name").max(120),
  /** The classes it's for: group ids; a group covers the groups inside it. */
  audience: z.array(z.uuid()).min(1, "Choose the classes it's for").max(500),
  instalments: z.array(instalmentSchema).max(24),
  /** The plan's updatedAt when the form opened (a newer one is refused). */
  expectedUpdatedAt,
})

export const feeSettingsSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, "1 to 10 letters, digits or dashes"),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(|\d{2}[A-Z0-9]{13})$/, "A GSTIN is 15 characters"),
  /** The institution's own Razorpay keys; an empty secret keeps the one saved. */
  razorpay: z
    .object({
      keyId: z.string().trim().max(40),
      keySecret: z.string().trim().max(100),
      webhookSecret: z.string().trim().max(100),
    })
    .nullable(),
})
