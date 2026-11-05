import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminOrganizations } from "@/features/admin/components/organizations"

export const metadata: Metadata = {
  title: "Organizations",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/organizations")

  return <AdminOrganizations />
}
