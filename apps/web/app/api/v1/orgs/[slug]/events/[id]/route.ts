import { route } from "@/lib/api/route"
import { cancelEvent, eventDetail, eventSchema, updateEvent } from "@/features/events/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  eventDetail(params.slug ?? "", user, params.id ?? "")
)

export const PUT = route({ access: "user", body: eventSchema }, ({ user, params, body }) =>
  updateEvent(params.slug ?? "", user, params.id ?? "", body)
)

/** Cancels it (it stays listed, marked cancelled); everyone coming is told. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  cancelEvent(params.slug ?? "", user, params.id ?? "")
)
