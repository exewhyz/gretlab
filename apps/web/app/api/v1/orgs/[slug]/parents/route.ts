import { route } from "@/lib/api/route"
import { readPage } from "@/lib/api/paging"
import { linkParent, linkSchema, listLinks } from "@/features/parents/server"

/** Parents linked to the students this person may see (Manage › Parents). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  listLinks(params.slug ?? "", user, readPage(query))
)

/** Links a parent, found or created by email, to a student. */
export const POST = route(
  { access: "user", body: linkSchema },
  ({ user, params, body }) => linkParent(params.slug ?? "", user, body)
)
