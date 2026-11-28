import { route } from "@/lib/api/route"
import { importExternalMarks, importSchema } from "@/features/university/exams"

/** External marks from a CSV: all or nothing, with a problem per line. */
export const POST = route(
  { access: "user", body: importSchema },
  ({ user, params, body }) =>
    importExternalMarks(params.slug ?? "", user, params.id ?? "", body)
)
