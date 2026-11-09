import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminUnits } from "@/features/admin/components/units"

export const metadata: Metadata = { title: "Units", robots: { index: false } }

export default async function Page() {
  await requireStaffPage("/admin/units")
  return <AdminUnits />
}
