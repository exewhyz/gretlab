import { z } from "zod"

import { route } from "@/lib/api/route"
import {
  feedbackForm,
  questionsSchema,
  saveFeedbackForm,
} from "@/features/feedback-rounds/server"

/** The feedback form every new feedback round starts with. */
export const GET = route({ access: "platform.feedback.manage" }, () =>
  feedbackForm()
)

export const PUT = route(
  {
    access: "platform.feedback.manage",
    stepUp: true,
    body: z.object({ questions: questionsSchema }),
  },
  ({ user, body }) => saveFeedbackForm(user, body.questions)
)
