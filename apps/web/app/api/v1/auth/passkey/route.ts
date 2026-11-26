import { authenticationOptions } from "@/features/auth/passkeys"
import { requestInfo } from "@/lib/api/request-context"
import { needWithinLimit } from "@/lib/api/rate-limit"
import { route } from "@/lib/api/route"

/** Options to sign in with a passkey: the browser offers the ones it holds for this site. */
export const POST = route({ access: "public" }, async () => {
  await needWithinLimit("passkey", requestInfo().ip)
  return authenticationOptions(null)
})
