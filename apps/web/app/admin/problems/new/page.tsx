import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { ProblemEditorPage } from "@/features/admin/components/problem-editor"

export const metadata: Metadata = {
  title: "New problem",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/problems")

  return <ProblemEditorPage id={null} />
}
