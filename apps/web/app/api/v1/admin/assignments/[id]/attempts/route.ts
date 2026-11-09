import { route } from "@/lib/api/route"
import { studentAttempts } from "@/features/assignments/server"

/**
 * ?student=email&problem=id: that student's graded code on that problem, and the code
 * they're writing now. &history=1 adds every snapshot, for playback.
 */
export const GET = route({ access: "platform.gradebook.view" }, ({ params, query }) =>
  studentAttempts(
    params.id ?? "",
    null,
    "all",
    query.get("student") ?? "",
    query.get("problem") ?? "",
    query.get("history") === "1"
  )
)
