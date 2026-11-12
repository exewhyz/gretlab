import { route } from "@/lib/api/route"
import { withdraw } from "@/features/admissions/server"

/** The applicant takes back an application still being decided. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  withdraw(params.slug ?? "", user, params.id ?? "")
)
