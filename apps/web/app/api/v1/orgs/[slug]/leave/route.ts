import { route } from "@/lib/api/route"
import { leaveHome, requestLeave, requestSchema } from "@/features/leave/server"

/** What you can ask for, your requests and balances, and what waits for you. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  leaveHome(params.slug ?? "", user)
)

/** Asks for leave: studentId for a student (yourself or your child), else your own staff leave. */
export const POST = route(
  { access: "user", body: requestSchema },
  ({ user, params, body }) => requestLeave(params.slug ?? "", user, body)
)
