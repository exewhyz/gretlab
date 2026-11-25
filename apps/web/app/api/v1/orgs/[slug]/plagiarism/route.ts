import { route } from "@/lib/api/route"
import {
  orgCheckable,
  orgRequest,
  orgSimilarity,
} from "@/features/plagiarism/server"

/** The organization's assignments and contests this person may check, with their problems. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgCheckable(params.slug ?? "", user)
)

/** Similar accepted code among one piece of work's students, or one pair side by side. */
export const POST = route(
  { access: "user", body: orgRequest },
  ({ user, params, body }) => orgSimilarity(params.slug ?? "", user, body)
)
