import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { QuestionEditorPage } from "@/features/questions/components/question-editor"

export const metadata: Metadata = { title: "Edit question", robots: { index: false } }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage("/admin/questions")
  const { id } = await params
  return <QuestionEditorPage id={id} />
}
