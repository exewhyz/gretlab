import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { OrgShell } from "@/features/home/components/org-shell"
import { MyAttendance } from "@/features/staff-attendance/components/staff-attendance"

export const metadata: Metadata = { title: "My attendance", robots: { index: false } }

/** A staff member's own attendance and today's check-in. */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!(await getCurrentUser())) redirect(`/sign-in?callbackUrl=/orgs/${slug}/my-attendance`)
  return (
    <OrgShell slug={slug}>
      <MyAttendance slug={slug} />
    </OrgShell>
  )
}
