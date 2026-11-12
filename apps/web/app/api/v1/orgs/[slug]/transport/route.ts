import { route } from "@/lib/api/route"
import {
  routeSchema,
  saveRoute,
  transportSetup,
} from "@/features/transport/server"

/** Routes with their stops and riders count, and what this person may do. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  transportSetup(params.slug ?? "", user)
)

/** Adds a route. */
export const POST = route(
  { access: "user", body: routeSchema },
  ({ user, params, body }) => saveRoute(params.slug ?? "", user, body)
)
