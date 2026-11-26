import { z } from "zod"

import { needRecentSecondStep, route } from "@/lib/api/route"
import { removeMethod } from "@/features/auth/two-factor"

/**
 * Removes a method (the last one turns two-factor off): with a current code, or without one after
 * a second step in the last ten minutes (a passkey, through the step-up dialog).
 */
export const POST = route(
  {
    access: "user",
    body: z.object({
      method: z.enum(["app", "email"]),
      code: z.string().trim().min(1).max(20).optional(),
    }),
  },
  ({ user, body }) => {
    if (!body.code) needRecentSecondStep()
    return removeMethod(user, body.method, body.code)
  }
)
