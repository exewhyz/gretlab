import { z } from "zod"

import { needRecentSecondStep, route } from "@/lib/api/route"
import { renewBackupCodes } from "@/features/auth/two-factor"

/**
 * New backup codes for old ones: with a current code, or without one after a second step in the
 * last ten minutes (a passkey, through the step-up dialog), so someone who uses only a passkey
 * isn't stuck.
 */
export const POST = route(
  {
    access: "user",
    body: z.object({ code: z.string().trim().min(1).max(20).optional() }),
  },
  ({ user, body }) => {
    if (!body.code) needRecentSecondStep()
    return renewBackupCodes(user, body.code)
  }
)
