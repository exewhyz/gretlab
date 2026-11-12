import { route } from "@/lib/api/route"
import { startEmailSetup } from "@/features/auth/two-factor"

/** Emails a code to turn on codes by email (confirmed through the session's update()). */
export const POST = route(
  { access: "user", beforeTwoFactor: true },
  ({ user }) => startEmailSetup(user)
)
