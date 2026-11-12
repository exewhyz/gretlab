import { route } from "@/lib/api/route"
import { setStatus, statusSchema } from "@/features/records/server"

/** Transferred, graduated or withdrawn this year (they leave their class), or active again. */
export const POST = route(
  { access: "user", body: statusSchema },
  ({ user, params, body }) =>
    setStatus(params.slug ?? "", user, params.id ?? "", body.status)
)
