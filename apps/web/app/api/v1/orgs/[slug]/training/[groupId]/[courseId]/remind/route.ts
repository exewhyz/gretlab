import { route } from "@/lib/api/route"
import { remindTraining } from "@/features/training/server"

/** Reminds everyone who hasn't finished it, or must renew it. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  remindTraining(params.slug ?? "", user, params.groupId ?? "", params.courseId ?? "")
)
