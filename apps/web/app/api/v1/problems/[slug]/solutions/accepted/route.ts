import { route } from "@/lib/api/route"
import { myAccepted } from "@/features/solutions/server"

/** Your accepted submissions for the problem, one per language, to share one of. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  myAccepted(params.slug ?? "", user)
)
