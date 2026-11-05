import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { ProblemEditorPage } from "@/features/admin/components/problem-editor"

export const metadata: Metadata = {
  title: "Edit problem",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireStaffPage("/admin/problems")
  const { id } = await params
  return <ProblemEditorPage id={id} />
}
