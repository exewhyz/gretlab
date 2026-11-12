import { route } from "@/lib/api/route"
import { twoFactorStatus } from "@/features/auth/two-factor"

/** Two-factor sign-in: on or off, backup codes left, whether it's required. */
export const GET = route(
  { access: "user", beforeTwoFactor: true },
  ({ user }) => twoFactorStatus(user)
)
