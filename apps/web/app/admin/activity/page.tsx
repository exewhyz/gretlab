import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { ActivityPage } from "@/features/platform/components/staff-page"

export const metadata: Metadata = { title: "Activity", robots: { index: false } }

export default async function Page() {
  await requireStaffPage("/admin/activity")
  return <ActivityPage />
}
