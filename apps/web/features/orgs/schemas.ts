import { MODULE_KEYS, ORG_TYPES, PERMISSION_KEYS } from "@workspace/judge"
import { z } from "zod"

const slug = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,47}$/,
    "Use 2-48 lowercase letters, numbers and dashes"
  )

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ""))
  .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Not a valid domain"))

export const orgCreateSchema = z.object({
  name: z.string().trim().min(2, "Give it a name").max(120),
  slug,
  type: z.enum(ORG_TYPES),
  ownerEmail: z.email("Enter the owner's email").toLowerCase(),
})

export const orgSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().max(5000),
    website: z.url("Enter a full address, like https://…").or(z.literal("")),
    type: z.enum(ORG_TYPES),
    listed: z.boolean(),
    joinPolicy: z.enum(["open", "approval", "invite"]),
    emailDomains: z.array(domain).max(20),
    groupLevels: z
      .array(z.string().trim().min(1).max(30))
      .min(1, "Name at least one level")
      .max(4, "At most 4 levels"),
    /** Optional modules switched on or off over the type's defaults. */
    modules: z.partialRecord(z.enum(MODULE_KEYS), z.boolean()),
    /** null: every language the platform has on. */
    languages: z.array(z.string().max(40)).max(50).nullable(),
    allowPaste: z.boolean(),
  })
  .partial()

export const joinSchema = z.object({ shareProgress: z.boolean() })

export const groupSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name").max(120),
  description: z.string().max(2000).default(""),
  parentId: z.uuid().nullable().default(null),
})

const permissions = z
  .array(z.enum(PERMISSION_KEYS as [string, ...string[]]))
  .max(PERMISSION_KEYS.length)

export const roleSchema = z.object({
  name: z.string().trim().min(2, "Give the role a name").max(60),
  description: z.string().max(500).default(""),
  permissions,
})

export const assignRoleSchema = z.object({
  roleId: z.uuid(),
  groupId: z.uuid().nullable().default(null),
})

export const memberUpdateSchema = z.object({
  /** Approve a pending request. */
  status: z.literal("active").optional(),
  groupIds: z.array(z.uuid()).max(50).optional(),
})

export const inviteSchema = z.object({
  label: z.string().trim().max(120).default(""),
  roleId: z.uuid().nullable().default(null),
  groupId: z.uuid().nullable().default(null),
  email: z.email().toLowerCase().nullable().default(null),
  maxUses: z.number().int().min(1).max(100_000).nullable().default(null),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(7),
})

export const importSchema = z.object({
  rows: z
    .array(
      z.object({
        email: z.string().max(320),
        name: z.string().max(200).default(""),
        /** A group path from the top: "CSE / 2026-A". */
        group: z.string().max(400).default(""),
        role: z.string().max(60).default(""),
      })
    )
    .min(1, "The file has no rows")
    .max(5000, "At most 5000 people at a time"),
  createGroups: z.boolean().default(false),
  /** false: only check and report what would happen. */
  commit: z.boolean().default(false),
})
