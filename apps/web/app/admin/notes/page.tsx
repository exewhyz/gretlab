import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { AdminNotes } from "@/features/admin/components/notes"

export const metadata: Metadata = {
  title: "Notices",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/notes")

  return <AdminNotes />
}
