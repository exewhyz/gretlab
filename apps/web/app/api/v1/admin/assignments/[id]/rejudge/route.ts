import { route } from "@/lib/api/route"
import { rejudgeSystemErrors } from "@/features/assignments/server"

/** Judges again every "System error" submission of this assignment, keeping its time. */
export const POST = route({ access: "platform.work.manage" }, ({ params }) =>
  rejudgeSystemErrors(params.id ?? "", null)
)
