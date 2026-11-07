import { clientIp } from "@/lib/api/client-ip"
import { route } from "@/lib/api/route"
import { startExam } from "@/features/exams/server"

/** Starts the student's one sitting (or returns the one in progress). */
export const POST = route({ access: "user" }, ({ user, params, request }) =>
  startExam(params.slug ?? "", user, clientIp(request))
)
