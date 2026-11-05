import { route } from "@/lib/api/route"
import { listMembers } from "@/features/orgs/server"

export const GET = route({ access: "user" }, ({ user, params, query }) =>
  listMembers(params.slug ?? "", user, {
    groupId: query.get("group") ?? undefined,
    status: query.get("status") ?? undefined,
    q: query.get("q") ?? undefined,
  })
)
