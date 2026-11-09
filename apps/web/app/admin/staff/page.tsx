import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { StaffPage } from "@/features/platform/components/staff-page"

export const metadata: Metadata = { title: "Staff and roles", robots: { index: false } }

export default async function Page() {
  await requireStaffPage("/admin/staff")
  return <StaffPage />
}
