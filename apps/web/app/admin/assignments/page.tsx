import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminAssignments } from "@/features/admin/components/assignments"

export const metadata: Metadata = {
  title: "Assignments",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/assignments")

  return <AdminAssignments />
}
