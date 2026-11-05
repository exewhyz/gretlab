import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { ContestEditorPage } from "@/features/admin/components/contests"

export const metadata: Metadata = {
  title: "New contest",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/contests")

  return <ContestEditorPage id={null} />
}
