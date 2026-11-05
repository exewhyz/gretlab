import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AssignmentEditorPage } from "@/features/admin/components/assignments"

export const metadata: Metadata = {
  title: "New assignment",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/assignments")

  return <AssignmentEditorPage id={null} />
}
