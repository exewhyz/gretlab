import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminLanguages } from "@/features/admin/components/languages"

export const metadata: Metadata = {
  title: "Languages",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/languages")

  return <AdminLanguages />
}
