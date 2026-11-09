import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { LibraryPage } from "@/features/library/components/library-page"

export const metadata: Metadata = { title: "Library", robots: { index: false } }

export default async function Page() {
  await requireStaffPage("/admin/library")
  return <LibraryPage />
}
