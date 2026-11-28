import { route } from "@/lib/api/route"
import {
  publishSchema,
  publishUniversityExam,
} from "@/features/university/exams"

/** Publishes the results, or takes them back: a protected action. */
export const POST = route(
  { access: "user", body: publishSchema, stepUp: true },
  ({ user, params, body }) =>
    publishUniversityExam(params.slug ?? "", user, params.id ?? "", body)
)
