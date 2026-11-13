import { route } from "@/lib/api/route"
import { assignTraining, assignTrainingSchema, listTraining } from "@/features/training/server"

/** The training this person can follow, with counts by status. */
export const GET = route({ access: "user" }, ({ user, params }) => listTraining(params.slug ?? "", user))

/** Assigns a course to a group as training, or changes its due date and renewal. */
export const POST = route({ access: "user", body: assignTrainingSchema }, ({ user, params, body }) =>
  assignTraining(params.slug ?? "", user, body)
)
