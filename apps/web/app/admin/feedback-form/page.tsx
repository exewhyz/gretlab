import type { Metadata } from "next"

import { FeedbackFormAdmin } from "@/features/feedback-rounds/components/feedback-form-admin"

export const metadata: Metadata = { title: "Feedback form" }

export default function Page() {
  return <FeedbackFormAdmin />
}
