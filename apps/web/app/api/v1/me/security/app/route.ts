import { route } from "@/lib/api/route"
import { startAppSetup } from "@/features/auth/two-factor"

/**
 * A new authenticator app secret (QR and key), and backup codes if this is the first
 * method. Confirmed with a code from the app through the session's update().
 */
export const POST = route(
  { access: "user", beforeTwoFactor: true },
  ({ user }) => startAppSetup(user)
)
