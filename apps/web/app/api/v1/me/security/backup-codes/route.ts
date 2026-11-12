import { z } from "zod"

import { route } from "@/lib/api/route"
import { renewBackupCodes } from "@/features/auth/two-factor"

/** New backup codes for old ones, with a current code. */
export const POST = route(
  {
    access: "user",
    body: z.object({ code: z.string().trim().min(1).max(20) }),
  },
  ({ user, body }) => renewBackupCodes(user, body.code)
)
