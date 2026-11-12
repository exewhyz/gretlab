import { route } from "@/lib/api/route"
import { examSettings, saveScale, scaleSchema } from "@/features/results/server"

/** The grading scale. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  examSettings(params.slug ?? "", user)
)

export const PUT = route(
  { access: "user", body: scaleSchema },
  ({ user, params, body }) => saveScale(params.slug ?? "", user, body)
)
