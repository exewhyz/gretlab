import { route } from "@/lib/api/route"
import { importSchema } from "@/features/orgs/schemas"
import { importMembers } from "@/features/orgs/server"

/** Checks a member list, or with `commit` imports it. */
export const POST = route(
  { access: "user", body: importSchema },
  ({ user, params, body }) => importMembers(params.slug ?? "", user, body)
)
