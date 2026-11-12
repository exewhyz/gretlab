import { z } from "zod"

import { ApiError, route } from "@/lib/api/route"
import {
  addStudent,
  listStudents,
  studentSchema,
} from "@/features/records/server"

const filters = z.object({
  q: z.string().max(100).optional(),
  groupId: z.uuid().optional(),
  status: z
    .enum(["active", "transferred", "graduated", "withdrawn", "unplaced"])
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
})

/** Student records: ?q (name, email, admission number), groupId, status, page. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const parsed = filters.safeParse(
    Object.fromEntries([...query.entries()].filter(([, v]) => v !== ""))
  )
  if (!parsed.success)
    throw new ApiError(400, "bad_filter", "Those filters don't make sense.")
  return listStudents(params.slug ?? "", user, parsed.data)
})

/** Adds a student: with an email they can sign in; without, they never sign in. */
export const POST = route(
  { access: "user", body: studentSchema },
  ({ user, params, body }) => addStudent(params.slug ?? "", user, body)
)
