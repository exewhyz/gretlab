import { route } from "@/lib/api/route"
import {
  createRound,
  listRounds,
  roundSchema,
} from "@/features/feedback-rounds/server"

/** The organization's feedback rounds, for whoever runs them. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  listRounds(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: roundSchema },
  ({ user, params, body }) => createRound(params.slug ?? "", user, body)
)
