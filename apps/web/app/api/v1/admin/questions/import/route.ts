import { route } from "@/lib/api/route"
import { questionImportSchema } from "@/features/questions/import"
import { importQuestions } from "@/features/questions/server"

/** Questions from a question file (docs/question-format.md). */
export const POST = route(
  { access: "teacher", body: questionImportSchema },
  ({ body }) => importQuestions(null, body.file, body.published)
)
