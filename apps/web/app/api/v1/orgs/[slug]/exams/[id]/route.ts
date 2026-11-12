import { route } from "@/lib/api/route"
import {
  deleteExam,
  examPatchSchema,
  getExam,
  updateExam,
} from "@/features/results/server"

/** An exam and its papers by class (those this person may see). */
export const GET = route({ access: "user" }, ({ user, params }) =>
  getExam(params.slug ?? "", user, params.id ?? "")
)

export const PATCH = route(
  { access: "user", body: examPatchSchema },
  ({ user, params, body }) =>
    updateExam(params.slug ?? "", user, params.id ?? "", body)
)

/** Deletes an unpublished exam, its papers and marks. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteExam(params.slug ?? "", user, params.id ?? "")
)
