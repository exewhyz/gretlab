import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminSettings } from "@/features/admin/components/settings"

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/settings")

  return <AdminSettings />
}
