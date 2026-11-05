import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminUsers } from "@/features/admin/components/users"

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/users")

  return <AdminUsers />
}
