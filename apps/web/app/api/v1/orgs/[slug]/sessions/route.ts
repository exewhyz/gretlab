import { route } from "@/lib/api/route"
import { logSession, sessionSchema } from "@/features/teaching/server"

/** Logs a class taught. */
export const POST = route(
  { access: "user", body: sessionSchema },
  ({ user, params, body }) => logSession(params.slug ?? "", user, body)
)
