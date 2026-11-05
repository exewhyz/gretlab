import { route } from "@/lib/api/route"
import {
  deleteOrgProblem,
  orgProblem,
  saveOrgProblem,
} from "@/features/orgs/content"
import { problemInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgProblem(params.slug ?? "", user, params.id ?? "")
)

export const PUT = route(
  { access: "user", body: problemInputSchema },
  ({ user, params, body }) =>
    saveOrgProblem(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteOrgProblem(params.slug ?? "", user, params.id ?? "")
)
