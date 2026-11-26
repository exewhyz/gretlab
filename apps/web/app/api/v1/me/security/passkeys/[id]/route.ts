import { route } from "@/lib/api/route"
import { removePasskey } from "@/features/auth/passkeys"

/** Removes one of your passkeys, after a recent second step. */
export const DELETE = route(
  { access: "user", beforeTwoFactor: true, stepUp: true },
  ({ user, params }) => removePasskey(user, params.id ?? "")
)
