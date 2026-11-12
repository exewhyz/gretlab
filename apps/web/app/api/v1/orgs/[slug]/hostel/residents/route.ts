import { route } from "@/lib/api/route"
import { allotBed, allotSchema } from "@/features/hostel/server"

/** Gives a member a bed, or moves them to it. */
export const POST = route(
  { access: "user", body: allotSchema },
  ({ user, params, body }) => allotBed(params.slug ?? "", user, body)
)
