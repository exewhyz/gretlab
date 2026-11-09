import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { TemplatesPage } from "@/features/templates/components/templates-page"

export const metadata: Metadata = { title: "Templates", robots: { index: false } }

export default async function Page() {
  await requireStaffPage("/admin/templates")
  return <TemplatesPage />
}
