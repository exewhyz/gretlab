import { route } from "@/lib/api/route"
import { deleteTerm, termPatchSchema, updateTerm } from "@/features/results/server"

export const PATCH = route(
  { access: "user", body: termPatchSchema },
  ({ user, params, body }) => updateTerm(params.slug ?? "", user, params.id ?? "", body)
)

/** Removes a term; its exams stay, without a term. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteTerm(params.slug ?? "", user, params.id ?? "")
)
