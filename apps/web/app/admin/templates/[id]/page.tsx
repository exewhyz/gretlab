import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { TemplatePage } from "@/features/templates/components/templates-page"

export const metadata: Metadata = { title: "Template", robots: { index: false } }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireStaffPage(`/admin/templates/${id}`)
  return <TemplatePage id={id === "new" ? null : id} />
}
