import { route } from "@/lib/api/route"
import { orgFeedbackForm } from "@/features/feedback-rounds/server"

/** The platform's feedback form, which a new round starts with. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgFeedbackForm(params.slug ?? "", user)
)
