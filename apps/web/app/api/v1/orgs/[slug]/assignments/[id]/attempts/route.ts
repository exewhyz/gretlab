import { route } from "@/lib/api/route"
import { orgStudentAttempts } from "@/features/orgs/content"

/** ?student=email&problem=id: that student's graded code on that problem. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  orgStudentAttempts(
    params.slug ?? "",
    user,
    params.id ?? "",
    query.get("student") ?? "",
    query.get("problem") ?? ""
  )
)
