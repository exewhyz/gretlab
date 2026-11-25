import { route } from "@/lib/api/route"
import { myRounds } from "@/features/feedback-rounds/server"

/** Open rounds where this person has teachers to rate. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  myRounds(params.slug ?? "", user)
)
