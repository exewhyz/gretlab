import { route } from "@/lib/api/route"
import { checkJudges } from "@/features/judges/server"

/** Tries every piece a start needs (sign-in, template, a dry-run start, the database parameter). */
export const GET = route({ access: "platform.judges.view" }, async () => ({
  results: await checkJudges(),
}))
