import { z } from "zod"

import { route } from "@/lib/api/route"
import { reportCard } from "@/features/results/server"

/** A student's report card ("me" for your own), for ?yearId or the latest year. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const yearId = z.uuid().safeParse(query.get("yearId")).data
  return reportCard(params.slug ?? "", user, params.studentId ?? "", yearId)
})
