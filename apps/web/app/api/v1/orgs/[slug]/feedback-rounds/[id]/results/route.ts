import { route } from "@/lib/api/route"
import { roundResults } from "@/features/feedback-rounds/server"

/** A round's results: everyone's for whoever runs rounds, a teacher's own for them. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  roundResults(params.slug ?? "", user, params.id ?? "")
)
