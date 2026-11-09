import { route } from "@/lib/api/route"
import { questionInputSchema } from "@/features/questions/schemas"
import {
  deleteQuestion,
  getQuestionForStaff,
  saveQuestion,
} from "@/features/questions/server"

export const GET = route({ access: "teacher" }, ({ params }) =>
  getQuestionForStaff(params.id ?? "", null)
)

export const PUT = route(
  { access: "teacher", body: questionInputSchema },
  ({ params, body }) => saveQuestion(params.id ?? "", body, null)
)

export const DELETE = route({ access: "teacher" }, ({ params }) =>
  deleteQuestion(params.id ?? "", null)
)
