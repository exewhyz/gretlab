import { route } from "@/lib/api/route"
import {
  deleteRound,
  roundSchema,
  updateRound,
} from "@/features/feedback-rounds/server"

export const PUT = route(
  { access: "user", body: roundSchema },
  ({ user, params, body }) =>
    updateRound(params.slug ?? "", user, params.id ?? "", body)
)

/** Deletes a round and its answers: a step-up action. */
export const DELETE = route(
  { stepUp: true, access: "user" },
  ({ user, params }) => deleteRound(params.slug ?? "", user, params.id ?? "")
)
