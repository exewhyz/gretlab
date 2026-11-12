import { route, ApiError } from "@/lib/api/route"
import { listRequests, listSchema } from "@/features/leave/server"

/** Requests you may decide: ?status, kind, page. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const parsed = listSchema.safeParse(
    Object.fromEntries([...query.entries()].filter(([, v]) => v !== ""))
  )
  if (!parsed.success)
    throw new ApiError(400, "bad_filter", "Those filters don't make sense.")
  return listRequests(params.slug ?? "", user, parsed.data)
})
