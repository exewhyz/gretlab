import { route } from "@/lib/api/route"
import { orgStudentAttempts } from "@/features/orgs/content"

/**
 * ?student=email&problem=id: that student's graded code on that problem, and the code
 * they're writing now. &history=1 adds every snapshot, for playback.
 */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  orgStudentAttempts(
    params.slug ?? "",
    user,
    params.id ?? "",
    query.get("student") ?? "",
    query.get("problem") ?? "",
    query.get("history") === "1"
  )
)
