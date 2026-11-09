import { route } from "@/lib/api/route"
import { orgRejudgeSystemErrors } from "@/features/orgs/content"

/** Judges again every "System error" submission of this assignment, keeping its time. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  orgRejudgeSystemErrors(params.slug ?? "", user, params.id ?? "")
)
