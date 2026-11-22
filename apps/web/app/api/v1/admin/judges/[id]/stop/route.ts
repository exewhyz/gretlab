import { route } from "@/lib/api/route"
import { stopJudge } from "@/features/judges/server"

/** Stops a judge machine: draining first if it's working. */
export const POST = route(
  { access: "platform.judges.stop" },
  ({ user, params }) => stopJudge(user, params.id ?? "")
)
