import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { QuestionsPage } from "@/features/questions/components/questions-page"

export const metadata: Metadata = { title: "Questions", robots: { index: false } }

export default async function Page() {
  await requireStaffPage("/admin/questions")
  return <QuestionsPage />
}
