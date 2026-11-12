import { route } from "@/lib/api/route"
import { marksSchema, paperSheet, saveMarks } from "@/features/results/server"

/** A paper's marks sheet. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  paperSheet(params.slug ?? "", user, params.id ?? "")
)

/** Saves marks; a blank that isn't absent clears one. */
export const PUT = route(
  { access: "user", body: marksSchema },
  ({ user, params, body }) =>
    saveMarks(params.slug ?? "", user, params.id ?? "", body)
)
