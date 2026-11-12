import { route } from "@/lib/api/route"
import { childOverview } from "@/features/parents/server"

/** One child, for their linked parent. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  childOverview(params.slug ?? "", user, params.studentId ?? "")
)
