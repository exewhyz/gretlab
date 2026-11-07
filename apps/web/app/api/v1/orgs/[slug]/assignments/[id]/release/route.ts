import { route } from "@/lib/api/route"
import { orgReleaseFeedback } from "@/features/orgs/content"

/** Shows held rubric marks and line comments to students. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  orgReleaseFeedback(params.slug ?? "", user, params.id ?? "")
)
