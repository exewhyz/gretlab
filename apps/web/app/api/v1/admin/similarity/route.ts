import { route } from "@/lib/api/route"
import {
  platformRequest,
  platformSimilarity,
} from "@/features/plagiarism/server"

/** Similar accepted code for a problem (optionally in one contest), or one pair side by side. */
export const POST = route(
  { access: "platform.submissions.view", body: platformRequest },
  ({ body }) => platformSimilarity(body)
)
