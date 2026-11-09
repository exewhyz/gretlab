import { route } from "@/lib/api/route"
import { questionInputSchema } from "@/features/questions/schemas"
import { listQuestionsForStaff, saveQuestion } from "@/features/questions/server"

/** The platform's question bank; ?for=picker for choosing them in a form. */
export const GET = route({ access: "platform.library.manage" }, ({ user, query }) =>
  listQuestionsForStaff(null, query.get("for") === "picker", user.id)
)

export const POST = route(
  { access: "platform.library.manage", body: questionInputSchema },
  ({ body }) => saveQuestion(null, body, null)
)
