import { route } from "@/lib/api/route"
import { universityCollege } from "@/features/university/oversight"

/** One affiliated college's registered students with their figures (?q=, ?page=). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  universityCollege(params.slug ?? "", user, params.collegeId ?? "", query)
)
