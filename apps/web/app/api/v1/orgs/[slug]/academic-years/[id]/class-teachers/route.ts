import { route } from "@/lib/api/route"
import {
  classTeachersOf,
  classTeachersSchema,
  setClassTeachers,
} from "@/features/records/server"

/** Each section's class teacher for this year, and who could be. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classTeachersOf(params.slug ?? "", user, params.id ?? "")
)

/** Sets some sections' class teachers (null: none). */
export const PUT = route(
  { access: "user", body: classTeachersSchema },
  ({ user, params, body }) =>
    setClassTeachers(params.slug ?? "", user, params.id ?? "", body)
)
