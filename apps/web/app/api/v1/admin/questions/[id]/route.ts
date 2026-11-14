import { route } from "@/lib/api/route"
import { questionInputSchema } from "@/features/questions/schemas"
import {
  deleteQuestion,
  getQuestionForStaff,
  saveQuestion,
} from "@/features/questions/server"

export const GET = route({ access: ["platform.library.create", "platform.library.edit"] }, ({ params }) =>
  getQuestionForStaff(params.id ?? "", null)
)

export const PUT = route(
  { access: "platform.library.edit", body: questionInputSchema },
  ({ params, body }) => saveQuestion(params.id ?? "", body, null)
)

export const DELETE = route({ access: "platform.library.delete" }, ({ params }) =>
  deleteQuestion(params.id ?? "", null)
)
