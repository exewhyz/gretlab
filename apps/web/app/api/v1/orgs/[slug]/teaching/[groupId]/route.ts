import { route } from "@/lib/api/route"
import {
  getGroupTeaching,
  saveSyllabus,
  syllabusSchema,
} from "@/features/teaching/server"

/** A group's syllabus, progress and logged classes. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  getGroupTeaching(params.slug ?? "", user, params.groupId ?? "")
)

export const PUT = route(
  { access: "user", body: syllabusSchema },
  ({ user, params, body }) =>
    saveSyllabus(params.slug ?? "", user, params.groupId ?? "", body)
)
