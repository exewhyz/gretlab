import { route } from "@/lib/api/route"
import {
  deleteContest,
  getContestForStaff,
  saveContest,
} from "@/features/contests/server"
import { contestInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "platform.work.manage" }, ({ params }) =>
  getContestForStaff(params.id ?? "", null)
)

export const PUT = route(
  { access: "platform.work.manage", body: contestInputSchema },
  ({ params, body }) => saveContest(params.id ?? "", body, null)
)

export const DELETE = route({ access: "platform.work.manage" }, ({ params }) =>
  deleteContest(params.id ?? "", null)
)
