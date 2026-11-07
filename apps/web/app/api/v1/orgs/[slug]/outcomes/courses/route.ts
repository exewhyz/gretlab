import { route } from "@/lib/api/route"
import { orgCourseOutcomes } from "@/features/outcomes/server"

/** Every course's outcomes, for tagging assignment problems. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgCourseOutcomes(params.slug ?? "", user)
)
