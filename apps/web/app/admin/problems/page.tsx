import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminProblems } from "@/features/admin/components/problems"

export const metadata: Metadata = {
  title: "Problems",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/problems")

  return <AdminProblems />
}
