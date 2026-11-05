import { route } from "@/lib/api/route"
import { getLanguages } from "@/features/settings/server"

export const GET = route({ access: "teacher" }, () => getLanguages())
