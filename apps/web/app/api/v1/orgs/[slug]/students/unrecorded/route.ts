import { route } from "@/lib/api/route"
import { recordEveryone, unrecordedCount } from "@/features/records/server"

/** How many people in classes have no student record. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  unrecordedCount(params.slug ?? "", user)
)

/** Gives them all a record and a place in the current year. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  recordEveryone(params.slug ?? "", user)
)
