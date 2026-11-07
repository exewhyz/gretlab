import { route } from "@/lib/api/route"
import { finishExam } from "@/features/exams/server"

/** Hands the exam in early. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  finishExam(params.slug ?? "", user)
)
