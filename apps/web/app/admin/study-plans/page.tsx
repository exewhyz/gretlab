import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminStudyPlans } from "@/features/admin/components/study-plans"

export const metadata: Metadata = {
  title: "Study plans",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/study-plans")
  return <AdminStudyPlans />
}
