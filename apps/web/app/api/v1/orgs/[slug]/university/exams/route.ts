import { route } from "@/lib/api/route"
import { collegeUniversityExams } from "@/features/university/exams"

/** The university exams this college's classes sit. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  collegeUniversityExams(params.slug ?? "", user)
)
