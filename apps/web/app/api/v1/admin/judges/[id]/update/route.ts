import { ApiError, route } from "@/lib/api/route"
import { platformCan } from "@/features/platform/access"
import { updateJudge } from "@/features/judges/server"

/** Replaces the machine with one running the latest code. Needs Start and Stop: it does both. */
export const POST = route(
  { access: "platform.judges.start" },
  async ({ user, params }) => {
    if (!(await platformCan(user, "platform.judges.stop")))
      throw new ApiError(
        403,
        "forbidden",
        'Updating needs "Stop judges" as well as "Start judges".'
      )
    return updateJudge(user, params.id ?? "")
  }
)
