import { z } from "zod"

import { route } from "@/lib/api/route"
import { addExam, examSchema, listExams } from "@/features/results/server"

/** The exams of a year (?yearId, else the current one), with marking progress. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const yearId = z.uuid().safeParse(query.get("yearId")).data
  return listExams(params.slug ?? "", user, yearId)
})

export const POST = route(
  { access: "user", body: examSchema },
  ({ user, params, body }) => addExam(params.slug ?? "", user, body)
)
