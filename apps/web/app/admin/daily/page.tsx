import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminDaily } from "@/features/admin/components/daily"

export const metadata: Metadata = {
  title: "Daily challenge",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/daily")
  return <AdminDaily />
}
