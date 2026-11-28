import { route } from "@/lib/api/route"
import { externalSchema, saveExternalMarks } from "@/features/university/exams"

/** The university's external marks for one course. */
export const PUT = route(
  { access: "user", body: externalSchema },
  ({ user, params, body }) =>
    saveExternalMarks(params.slug ?? "", user, params.id ?? "", body)
)
