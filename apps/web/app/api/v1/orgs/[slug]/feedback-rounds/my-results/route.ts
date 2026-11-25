import { route } from "@/lib/api/route"
import { myResults } from "@/features/feedback-rounds/server"

/** A teacher's own results in every round. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  myResults(params.slug ?? "", user)
)
