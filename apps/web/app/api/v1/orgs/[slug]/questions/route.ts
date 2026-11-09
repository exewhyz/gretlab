import { route } from "@/lib/api/route"
import { orgQuestions, saveOrgQuestion } from "@/features/orgs/content"
import { questionInputSchema } from "@/features/questions/schemas"

export const GET = route({ access: "user" }, ({ user, params, query }) =>
  orgQuestions(params.slug ?? "", user, query.get("for") === "picker")
)

export const POST = route(
  { access: "user", body: questionInputSchema },
  ({ user, params, body }) => saveOrgQuestion(params.slug ?? "", user, null, body)
)
