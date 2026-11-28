import { route } from "@/lib/api/route"
import { universityOverview } from "@/features/university/oversight"

/** A university's affiliated colleges with their figures (?q=, ?page=). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  universityOverview(params.slug ?? "", user, query)
)
