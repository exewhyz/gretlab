import { route } from "@/lib/api/route"
import { readPage } from "@/lib/api/paging"
import { listMembers } from "@/features/orgs/server"

export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const { page, q, perPage } = readPage(query)
  const filter = {
    groupId: query.get("group") ?? undefined,
    status: query.get("status") ?? undefined,
    q,
  }
  // With a page: one page of members, read from the database, and the counts by kind (the
  // Members screen); without, everyone.
  return page
    ? listMembers(params.slug ?? "", user, {
        ...filter,
        page,
        perPage,
        kind: query.get("kind") ?? undefined,
      })
    : listMembers(params.slug ?? "", user, filter)
})
