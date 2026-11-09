import { route } from "@/lib/api/route"
import {
  deleteOrgQuestion,
  orgQuestion,
  saveOrgQuestion,
} from "@/features/orgs/content"
import { questionInputSchema } from "@/features/questions/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgQuestion(params.slug ?? "", user, params.id ?? "")
)

export const PUT = route(
  { access: "user", body: questionInputSchema },
  ({ user, params, body }) =>
    saveOrgQuestion(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteOrgQuestion(params.slug ?? "", user, params.id ?? "")
)
