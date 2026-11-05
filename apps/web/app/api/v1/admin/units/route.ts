import { z } from "zod"

import { route } from "@/lib/api/route"
import { createUnit } from "@/features/problems/server"

export const POST = route(
  {
    access: "teacher",
    body: z.object({ name: z.string().trim().min(1).max(200) }),
  },
  ({ body }) => createUnit(body.name)
)
