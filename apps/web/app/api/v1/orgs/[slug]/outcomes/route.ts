import { route } from "@/lib/api/route"
import { programOutcomesSchema } from "@/features/outcomes/schemas"
import {
  getProgramOutcomes,
  saveProgramOutcomes,
} from "@/features/outcomes/server"

/** The organization's program outcomes and how attainment is judged. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  getProgramOutcomes(params.slug ?? "", user)
)

export const PUT = route(
  { access: "user", body: programOutcomesSchema },
  ({ user, params, body }) => saveProgramOutcomes(params.slug ?? "", user, body)
)
