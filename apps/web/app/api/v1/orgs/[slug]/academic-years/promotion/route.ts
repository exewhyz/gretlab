import { z } from "zod"

import { ApiError, route } from "@/lib/api/route"
import {
  promote,
  promoteSchema,
  promotionPlan,
} from "@/features/records/server"

/** ?from=&to= (year ids): each section's students and a suggested destination. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const ids = z
    .object({ from: z.uuid(), to: z.uuid() })
    .safeParse(Object.fromEntries(query.entries()))
  if (!ids.success)
    throw new ApiError(
      400,
      "bad_filter",
      "Choose the years to promote from and to."
    )
  return promotionPlan(params.slug ?? "", user, ids.data.from, ids.data.to)
})

/** Counts what would happen (apply: false), or does it. */
export const POST = route(
  { access: "user", body: promoteSchema },
  ({ user, params, body }) => promote(params.slug ?? "", user, body)
)
