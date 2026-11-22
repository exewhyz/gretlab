import { ApiError, route } from "@/lib/api/route"
import { platformCan } from "@/features/platform/access"
import { updateAllJudges } from "@/features/judges/server"

/** Every out-of-date machine, replaced one at a time. Needs Start and Stop: it does both. */
export const POST = route(
  { access: "platform.judges.start" },
  async ({ user }) => {
    if (!(await platformCan(user, "platform.judges.stop")))
      throw new ApiError(
        403,
        "forbidden",
        'Updating needs "Stop judges" as well as "Start judges".'
      )
    return updateAllJudges(user)
  }
)
