import { route } from "@/lib/api/route"
import { tokenSchema, verifyEmail } from "@/features/auth/password"
import { ApiError } from "@/lib/api/errors"

/** Confirms an address from its emailed link (a button press, so mail scanners can't use it up). */
export const POST = route({ access: "public", body: tokenSchema }, async ({ body }) => {
  const done = await verifyEmail(body.token)
  if (!done) throw new ApiError(400, "bad_link", "This link has expired or was already used.")
  return done
})
