import { readSession } from "@/features/auth/current-user"
import { emailSignInCode } from "@/features/auth/two-factor"
import { ApiError, route } from "@/lib/api/route"

/**
 * Emails a sign-in code to someone who signed in with Google and owes the second step.
 * Public, because such a session isn't signed in yet; it acts only on that session's person.
 */
export const POST = route({ access: "public" }, async () => {
  const { pending } = await readSession()
  if (!pending)
    throw new ApiError(401, "unauthenticated", "Sign in first.")
  return emailSignInCode(pending)
})
