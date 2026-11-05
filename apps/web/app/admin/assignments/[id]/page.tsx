import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AssignmentEditorPage } from "@/features/admin/components/assignments"

export const metadata: Metadata = {
  title: "Edit assignment",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireStaffPage("/admin/assignments")
  const { id } = await params
  return <AssignmentEditorPage id={id} />
}
