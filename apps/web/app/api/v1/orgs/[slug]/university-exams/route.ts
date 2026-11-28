import { route } from "@/lib/api/route"
import {
  createUniversityExam,
  examSchema,
  listUniversityExams,
} from "@/features/university/exams"

/** A university's exams. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  listUniversityExams(params.slug ?? "", user)
)

/** Sets an exam for a program's semester. */
export const POST = route(
  { access: "user", body: examSchema },
  ({ user, params, body }) =>
    createUniversityExam(params.slug ?? "", user, body)
)
