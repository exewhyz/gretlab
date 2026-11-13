import { route } from "@/lib/api/route"
import { rsvp, rsvpSchema } from "@/features/events/server"

/** Going (a place, or the waitlist when full) or not going. */
export const PUT = route({ access: "user", body: rsvpSchema }, ({ user, params, body }) =>
  rsvp(params.slug ?? "", user, params.id ?? "", body.going)
)
