import { route } from "@/lib/api/route"
import { subjectOptions } from "@/features/feedback-rounds/server"

/** The organization's subjects, for choosing which a round covers. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  subjectOptions(params.slug ?? "", user)
)
