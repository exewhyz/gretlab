import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { QuestionEditorPage } from "@/features/questions/components/question-editor"

export const metadata: Metadata = { title: "New question", robots: { index: false } }

export default async function Page() {
  await requireStaffPage("/admin/questions")
  return <QuestionEditorPage id={null} />
}
