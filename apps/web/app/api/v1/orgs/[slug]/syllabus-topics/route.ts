import { route } from "@/lib/api/route"
import { orgSyllabusTopics } from "@/features/teaching/server"

/** Every class's syllabus topics, for tagging an assignment with the topics it covers. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgSyllabusTopics(params.slug ?? "", user)
)
