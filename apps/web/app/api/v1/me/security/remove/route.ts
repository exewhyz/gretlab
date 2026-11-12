import { z } from "zod"

import { route } from "@/lib/api/route"
import { removeMethod } from "@/features/auth/two-factor"

/** Removes a method (the last one turns two-factor off), with a current code. */
export const POST = route(
  {
    access: "user",
    body: z.object({
      method: z.enum(["app", "email"]),
      code: z.string().trim().min(1).max(20),
    }),
  },
  ({ user, body }) => removeMethod(user, body.method, body.code)
)
