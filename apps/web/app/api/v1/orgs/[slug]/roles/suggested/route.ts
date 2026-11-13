import { z } from "zod"

import { route } from "@/lib/api/route"
import { addSuggestedRole, suggestedRoles } from "@/features/orgs/server"

/** The kind's suggested roles this organization doesn't have yet. */
export const GET = route({ access: "user" }, ({ user, params }) => suggestedRoles(params.slug ?? "", user))

/** Adds one of them. */
export const POST = route({ access: "user", body: z.object({ key: z.string().max(40) }) }, ({ user, params, body }) =>
  addSuggestedRole(params.slug ?? "", user, body.key)
)
