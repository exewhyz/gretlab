import { route } from "@/lib/api/route"
import { saveJudgeSettings, settingsSchema } from "@/features/judges/server"

/** How many judge machines may run, and their size. */
export const PUT = route(
  { stepUp: true, access: "platform.judges.settings", body: settingsSchema },
  ({ user, body }) => saveJudgeSettings(user, body)
)
