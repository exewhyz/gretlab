import { route } from "@/lib/api/route"
import {
  deleteContest,
  getContestForStaff,
  saveContest,
} from "@/features/contests/server"
import { contestInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "teacher" }, ({ params }) =>
  getContestForStaff(params.id ?? "", null)
)

export const PUT = route(
  { access: "teacher", body: contestInputSchema },
  ({ params, body }) => saveContest(params.id ?? "", body, null)
)

export const DELETE = route({ access: "teacher" }, ({ params }) =>
  deleteContest(params.id ?? "", null)
)
