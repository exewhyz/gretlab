import { route } from "@/lib/api/route"
import {
  getStudent,
  studentSchema,
  updateStudent,
} from "@/features/records/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  getStudent(params.slug ?? "", user, params.id ?? "")
)

export const PUT = route(
  { access: "user", body: studentSchema },
  ({ user, params, body }) =>
    updateStudent(params.slug ?? "", user, params.id ?? "", body)
)
