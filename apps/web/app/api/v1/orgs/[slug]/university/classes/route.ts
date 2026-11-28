import { route } from "@/lib/api/route"
import {
  collegePrograms,
  mapClass,
  mapSchema,
} from "@/features/university/syllabus"

/** The university's programs, and which of the college's classes follow which semester. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  collegePrograms(params.slug ?? "", user)
)

/** A class follows a university program's semester and takes its courses. */
export const POST = route(
  { access: "user", body: mapSchema },
  ({ user, params, body }) => mapClass(params.slug ?? "", user, body)
)
