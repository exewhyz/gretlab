import { route } from "@/lib/api/route"
import {
  createSubject,
  listSubjects,
  subjectSchema,
} from "@/features/subjects/server"

/** The organization's subjects, with the classes that take them. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  listSubjects(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: subjectSchema },
  ({ user, params, body }) => createSubject(params.slug ?? "", user, body)
)
