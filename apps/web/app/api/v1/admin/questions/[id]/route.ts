import { route } from "@/lib/api/route"
import { questionInputSchema } from "@/features/questions/schemas"
import {
  deleteQuestion,
  getQuestionForStaff,
  saveQuestion,
} from "@/features/questions/server"

export const GET = route({ access: "platform.library.manage" }, ({ params }) =>
  getQuestionForStaff(params.id ?? "", null)
)

export const PUT = route(
  { access: "platform.library.manage", body: questionInputSchema },
  ({ params, body }) => saveQuestion(params.id ?? "", body, null)
)

export const DELETE = route({ access: "platform.library.manage" }, ({ params }) =>
  deleteQuestion(params.id ?? "", null)
)
