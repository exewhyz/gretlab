import { route } from "@/lib/api/route"
import { addHostel, hostelSchema, hostelSetup } from "@/features/hostel/server"

/** Hostels with their rooms, beds and how many are taken, and what this person may do. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  hostelSetup(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: hostelSchema },
  ({ user, params, body }) => addHostel(params.slug ?? "", user, body)
)
