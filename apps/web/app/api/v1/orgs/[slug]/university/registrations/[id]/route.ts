import { route } from "@/lib/api/route"
import { cancelRegistration } from "@/features/university/registrations"

/** Cancels a registration still waiting for the university. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  cancelRegistration(params.slug ?? "", user, params.id ?? "")
)
