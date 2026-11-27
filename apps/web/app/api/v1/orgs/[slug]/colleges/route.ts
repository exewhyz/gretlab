import { route } from "@/lib/api/route"
import { universityColleges } from "@/features/university/affiliation"

/** A university's affiliated colleges and requests (?status=requested|active, ?q=, ?page=). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  universityColleges(params.slug ?? "", user, query)
)
