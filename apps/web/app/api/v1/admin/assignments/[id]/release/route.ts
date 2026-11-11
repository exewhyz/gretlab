import { route } from "@/lib/api/route"
import { releaseFeedback } from "@/features/assignments/server"

/** Shows held rubric marks and line comments to students. */
export const POST = route({ access: "platform.work.grade" }, ({ params }) =>
  releaseFeedback(params.id ?? "", null)
)
