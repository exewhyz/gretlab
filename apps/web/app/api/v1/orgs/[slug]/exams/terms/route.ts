import { route } from "@/lib/api/route"
import { addTerm, termSchema } from "@/features/results/server"

/** Adds a term (a semester in a college) to an academic year. */
export const POST = route(
  { access: "user", body: termSchema },
  ({ user, params, body }) => addTerm(params.slug ?? "", user, body)
)
