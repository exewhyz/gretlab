import { route } from "@/lib/api/route"
import { runProgress } from "@/features/runs/server"

/** One run's learners and their progress, by pod. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  runProgress(params.slug ?? "", user, params.id ?? "")
)
