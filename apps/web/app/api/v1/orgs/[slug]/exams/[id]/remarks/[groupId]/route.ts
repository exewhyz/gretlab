import { route } from "@/lib/api/route"
import {
  remarksSchema,
  remarksSheet,
  saveRemarks,
} from "@/features/results/server"

/** A class's overall remarks in this exam, with each student's result. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  remarksSheet(params.slug ?? "", user, params.id ?? "", params.groupId ?? "")
)

/** Saves overall remarks; an empty one removes it. */
export const PUT = route(
  { access: "user", body: remarksSchema },
  ({ user, params, body }) =>
    saveRemarks(params.slug ?? "", user, params.id ?? "", params.groupId ?? "", body)
)
