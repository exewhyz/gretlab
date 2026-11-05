import { route } from "@/lib/api/route"
import {
  deleteOrgContest,
  orgContest,
  saveOrgContest,
} from "@/features/orgs/content"
import { contestInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgContest(params.slug ?? "", user, params.id ?? "")
)

export const PUT = route(
  { access: "user", body: contestInputSchema },
  ({ user, params, body }) =>
    saveOrgContest(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteOrgContest(params.slug ?? "", user, params.id ?? "")
)
