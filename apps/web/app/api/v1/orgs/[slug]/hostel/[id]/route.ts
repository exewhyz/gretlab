import { route } from "@/lib/api/route"
import {
  deleteHostel,
  hostelSchema,
  updateHostel,
} from "@/features/hostel/server"

export const PUT = route(
  { access: "user", body: hostelSchema },
  ({ user, params, body }) =>
    updateHostel(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteHostel(params.slug ?? "", user, params.id ?? "")
)
