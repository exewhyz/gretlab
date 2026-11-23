import { route } from "@/lib/api/route"
import { cancelJob } from "@/features/jobs/server"

export const POST = route({ access: "user" }, ({ user, params }) =>
  cancelJob(user, params.id ?? "")
)
