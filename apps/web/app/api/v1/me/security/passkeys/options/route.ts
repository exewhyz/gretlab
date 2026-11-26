import { route } from "@/lib/api/route"
import { authenticationOptions } from "@/features/auth/passkeys"

/** Options to confirm a protected action with one of your passkeys (step-up). */
export const POST = route({ access: "user", beforeTwoFactor: true }, ({ user }) =>
  authenticationOptions(user)
)
