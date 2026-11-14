import { route } from "@/lib/api/route"
import { listMembers } from "@/features/orgs/server"

export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const filter = {
    groupId: query.get("group") ?? undefined,
    status: query.get("status") ?? undefined,
    q: query.get("q") ?? undefined,
  }
  const page = query.get("page")
  // With a page: one page of 100 and the counts by kind (the Members screen); without, everyone.
  return page
    ? listMembers(params.slug ?? "", user, {
        ...filter,
        page: Number(page) || 1,
        kind: query.get("kind") ?? undefined,
      })
    : listMembers(params.slug ?? "", user, filter)
})
