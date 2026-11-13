import { route } from "@/lib/api/route"
import { listRuns } from "@/features/runs/server"

/** The runs (cohorts, batches with dates) this person can see. */
export const GET = route({ access: "user" }, ({ user, params }) => listRuns(params.slug ?? "", user))
