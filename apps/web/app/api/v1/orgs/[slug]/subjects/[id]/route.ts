import { route } from "@/lib/api/route"
import {
  deleteSubject,
  subjectSchema,
  updateSubject,
} from "@/features/subjects/server"

export const PUT = route(
  { access: "user", body: subjectSchema },
  ({ user, params, body }) =>
    updateSubject(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteSubject(params.slug ?? "", user, params.id ?? "")
)
