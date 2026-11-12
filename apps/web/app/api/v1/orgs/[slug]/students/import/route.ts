import { route } from "@/lib/api/route"
import { importSchema, importStudents } from "@/features/records/server"

/** Students from a spreadsheet: a report per line; commit: true adds them all. */
export const POST = route(
  { access: "user", body: importSchema },
  ({ user, params, body }) => importStudents(params.slug ?? "", user, body)
)
