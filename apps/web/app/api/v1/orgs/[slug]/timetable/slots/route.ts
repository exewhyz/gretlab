import { route } from "@/lib/api/route"
import { setSlot, slotSchema } from "@/features/timetable/server"

/** Fill or clear one cell of a class's week. */
export const PUT = route(
  { access: "user", body: slotSchema },
  ({ user, params, body }) => setSlot(params.slug ?? "", user, body)
)
