import { route } from "@/lib/api/route"
import { autoscaleJudges } from "@/features/judges/autoscale"
import {
  listJudges,
  reconcileJudges,
  startJudge,
  startSchema,
} from "@/features/judges/server"

/** The judge machines, each brought up to date with AWS first. */
export const GET = route({ access: "platform.judges.view" }, async () => {
  await reconcileJudges()
  await autoscaleJudges()
  return listJudges()
})

/** Starts a judge machine, for everyone or for one organization (`pool`). */
export const POST = route(
  { access: "platform.judges.start", body: startSchema },
  ({ user, body }) => startJudge(user, body)
)
