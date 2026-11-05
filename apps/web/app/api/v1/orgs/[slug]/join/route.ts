import { route } from "@/lib/api/route"
import { joinOrganization } from "@/features/orgs/server"
import { joinSchema } from "@/features/orgs/schemas"

export const POST = route(
  { access: "user", body: joinSchema },
  ({ user, params, body }) =>
    joinOrganization(params.slug ?? "", user, body.shareProgress)
)
