import { route } from "@/lib/api/route"
import {
  deletePaper,
  paperPatchSchema,
  updatePaper,
} from "@/features/results/server"

export const PATCH = route(
  { access: "user", body: paperPatchSchema },
  ({ user, params, body }) =>
    updatePaper(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deletePaper(params.slug ?? "", user, params.id ?? "")
)
