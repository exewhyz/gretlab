import { route } from "@/lib/api/route"
import { orgImportQuestions } from "@/features/orgs/content"
import { questionImportSchema } from "@/features/questions/import"

/** Questions from a question file (docs/question-format.md). */
export const POST = route(
  { access: "user", body: questionImportSchema },
  ({ user, params, body }) => orgImportQuestions(params.slug ?? "", user, body)
)
