import { route } from "@/lib/api/route"
import { getApplication } from "@/features/admissions/server"

/** One application in full, with what's needed to admit. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  getApplication(params.slug ?? "", user, params.id ?? "")
)
