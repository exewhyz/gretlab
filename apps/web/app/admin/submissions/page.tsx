import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminSubmissions } from "@/features/admin/components/submissions"

export const metadata: Metadata = {
  title: "Submissions",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/submissions")

  return <AdminSubmissions />
}
