import { route } from "@/lib/api/route"
import { createEvent, eventSchema, listEvents } from "@/features/events/server"

/** Upcoming events this person may see; ?when=past for past ones. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  listEvents(params.slug ?? "", user, query.get("when") === "past" ? "past" : "upcoming")
)

export const POST = route({ access: "user", body: eventSchema }, ({ user, params, body }) =>
  createEvent(params.slug ?? "", user, body)
)
