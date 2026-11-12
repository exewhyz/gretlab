import { z } from "zod"

import { ApiError, route } from "@/lib/api/route"
import { examResults } from "@/features/results/server"

/** ?groupId: a class's results in this exam. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const groupId = z.uuid().safeParse(query.get("groupId")).data
  if (!groupId) throw new ApiError(400, "bad_filter", "Choose a class.")
  return examResults(params.slug ?? "", user, params.id ?? "", groupId)
})
