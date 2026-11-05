import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { ContestEditorPage } from "@/features/admin/components/contests"

export const metadata: Metadata = {
  title: "Edit contest",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireStaffPage("/admin/contests")
  const { id } = await params
  return <ContestEditorPage id={id} />
}
