import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminContests } from "@/features/admin/components/contests"

export const metadata: Metadata = {
  title: "Contests",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/contests")

  return <AdminContests />
}
