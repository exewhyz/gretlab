import { route } from "@/lib/api/route"
import {
  internalSchema,
  internalSheet,
  saveInternalMarks,
} from "@/features/university/exams"

/** The college's internal marks sheet for a university exam. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  internalSheet(params.slug ?? "", user, params.id ?? "")
)

/** Saves internal marks for one course, until the university closes them. */
export const PUT = route(
  { access: "user", body: internalSchema },
  ({ user, params, body }) =>
    saveInternalMarks(params.slug ?? "", user, params.id ?? "", body)
)
