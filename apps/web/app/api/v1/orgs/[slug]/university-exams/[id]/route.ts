import { route } from "@/lib/api/route"
import { universityExamSheet } from "@/features/university/exams"

/** One exam: its courses and a page of who sits it, with marks and results (?college=, ?q=, ?page=). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  universityExamSheet(params.slug ?? "", user, params.id ?? "", query)
)
