import { route } from "@/lib/api/route"
import { studentAttempts } from "@/features/assignments/server"

/** ?student=email&problem=id: that student's graded code on that problem. */
export const GET = route({ access: "teacher" }, ({ params, query }) =>
  studentAttempts(
    params.id ?? "",
    null,
    "all",
    query.get("student") ?? "",
    query.get("problem") ?? ""
  )
)
