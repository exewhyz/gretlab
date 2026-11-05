import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminOverview } from "@/features/admin/components/overview"

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin")

  return <AdminOverview />
}
