import { route } from "@/lib/api/route"
import { admissionForm } from "@/features/admissions/server"

/** Whether admissions are open, for which year and classes, and your applications. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  admissionForm(params.slug ?? "", user)
)
