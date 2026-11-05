import { route } from "@/lib/api/route"
import { listStudyPlans } from "@/features/catalog/server"

export const GET = route({ access: "teacher" }, () => listStudyPlans())
