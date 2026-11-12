import { route } from "@/lib/api/route"
import { orgHome } from "@/features/home/server"

/** The school's home: a dashboard for each of your views here (admin, teacher…). */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgHome(params.slug ?? "", user)
)
