import { route } from "@/lib/api/route"
import { jobView } from "@/features/jobs/server"

/** A background job its starter is following: status, progress, result. Others get 404. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  jobView(user, params.id ?? "")
)
