import { z } from "zod"

import { route } from "@/lib/api/route"
import { createList, getLists } from "@/features/catalog/server"

export const GET = route({ access: "public" }, ({ user }) => getLists(user))

export const POST = route(
  {
    access: "user",
    body: z.object({
      title: z.string().trim().min(1, "Give the list a name").max(100),
      description: z.string().max(2000).default(""),
      kind: z.enum(["custom", "study_plan"]).default("custom"),
    }),
  },
  ({ user, body }) => createList(user, body)
)
