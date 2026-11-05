import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminIntegrity } from "@/features/admin/components/integrity"

export const metadata: Metadata = {
  title: "Integrity",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/integrity")
  return <AdminIntegrity />
}
