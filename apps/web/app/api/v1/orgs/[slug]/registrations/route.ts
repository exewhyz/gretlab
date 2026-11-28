import { route } from "@/lib/api/route"
import { universityRegistrationList } from "@/features/university/registrations"

/** A university's registrations from its affiliated colleges (?status=, ?college=, ?q=, ?page=). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  universityRegistrationList(params.slug ?? "", user, query)
)
