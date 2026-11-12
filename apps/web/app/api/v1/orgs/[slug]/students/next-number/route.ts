import { route } from "@/lib/api/route"
import { nextNumber } from "@/features/records/server"

/** The next free admission number. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  nextNumber(params.slug ?? "", user)
)
