import { route } from "@/lib/api/route"
import { orgContests, saveOrgContest } from "@/features/orgs/content"
import { contestInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgContests(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: contestInputSchema },
  ({ user, params, body }) =>
    saveOrgContest(params.slug ?? "", user, null, body)
)
