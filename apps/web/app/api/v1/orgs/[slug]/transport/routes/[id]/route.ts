import { route } from "@/lib/api/route"
import {
  deleteRoute,
  routeSchema,
  saveRoute,
} from "@/features/transport/server"

export const PUT = route(
  { access: "user", body: routeSchema },
  ({ user, params, body }) =>
    saveRoute(params.slug ?? "", user, body, params.id ?? "")
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteRoute(params.slug ?? "", user, params.id ?? "")
)
