import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminLanding } from "@/features/landing/components/admin-landing"

export const metadata: Metadata = {
  title: "Landing page",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/landing")
  return <AdminLanding />
}
