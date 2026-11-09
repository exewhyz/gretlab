import { z } from "zod"

export const itemRef = z.object({ kind: z.enum(["problem", "question"]), id: z.uuid() })

export const collectionSchema = z.object({
  name: z.string().trim().min(1, "Name the collection").max(120),
  description: z.string().max(1000).default(""),
})

export const collectionChangeSchema = z.object({
  add: z.array(itemRef).max(500).default([]),
  remove: z.array(itemRef).max(500).default([]),
})

export const sharingSchema = z.object({
  items: z
    .array(z.object({ kind: z.enum(["problem", "question", "course", "template"]), id: z.uuid() }))
    .min(1)
    .max(500),
  sharing: z.enum(["everyone", "selected", "owner"]),
  orgIds: z.array(z.uuid()).max(500).default([]),
  emails: z.array(z.email()).max(500).default([]),
})

export const copySchema = z.object({ items: z.array(itemRef).min(1).max(200) })
