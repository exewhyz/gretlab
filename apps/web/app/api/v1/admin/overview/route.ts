import { route } from "@/lib/api/route"
import { getOverview } from "@/features/admin/server"

export const GET = route({ access: "teacher" }, () => getOverview())
