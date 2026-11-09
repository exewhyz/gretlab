import { z } from "zod"

/** A custom platform role as its form saves it. */
export const roleSchema = z.object({
  name: z.string().trim().min(1, "Name the role").max(80),
  description: z.string().max(500).default(""),
  permissions: z.array(z.string()).max(50),
})
