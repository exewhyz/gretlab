import { readSession } from "@/features/auth/current-user"
import { authenticationOptions } from "@/features/auth/passkeys"
import { ApiError, route } from "@/lib/api/route"

/**
 * Options for the second step with a passkey. Public, because such a session isn't signed in
 * yet; it acts only on that session's person and their own passkeys.
 */
export const POST = route({ access: "public" }, async () => {
  const { pending } = await readSession()
  if (!pending) throw new ApiError(401, "unauthenticated", "Sign in first.")
  return authenticationOptions(pending)
})
