import { route } from "@/lib/api/route"
import { costs } from "@/features/costs/server"

/** What judge machines cost this month, by organization, with a forecast. */
export const GET = route({ access: "platform.costs.view" }, () => costs())
