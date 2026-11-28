import { route } from "@/lib/api/route"
import {
  collegeRegistrations,
  registerSchema,
  registerStudents,
} from "@/features/university/registrations"

/** The college's registrations with its university (?status=, ?q=, ?page=). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  collegeRegistrations(params.slug ?? "", user, query)
)

/** Registers a class's students, or chosen ones, for a program and admission year. */
export const POST = route(
  { access: "user", body: registerSchema },
  ({ user, params, body }) => registerStudents(params.slug ?? "", user, body)
)
