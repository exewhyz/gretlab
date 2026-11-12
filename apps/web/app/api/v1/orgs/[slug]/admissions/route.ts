import { ApiError, route } from "@/lib/api/route"
import {
  apply,
  applySchema,
  listApplications,
  listSchema,
} from "@/features/admissions/server"

/** Applications, for the office: ?status, gradeId, q, page. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const parsed = listSchema.safeParse(
    Object.fromEntries([...query.entries()].filter(([, v]) => v !== ""))
  )
  if (!parsed.success)
    throw new ApiError(400, "bad_filter", "Those filters don't make sense.")
  return listApplications(params.slug ?? "", user, parsed.data)
})

/** Applies for admission. */
export const POST = route(
  { access: "user", body: applySchema },
  ({ user, params, body }) => apply(params.slug ?? "", user, body)
)
