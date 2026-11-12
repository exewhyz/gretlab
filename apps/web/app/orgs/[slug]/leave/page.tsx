import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { OrgShell } from "@/features/home/components/org-shell"
import { LeavePage } from "@/features/leave/components/leave"

export const metadata: Metadata = { title: "Leave", robots: { index: false } }

/** Asking for leave (students, parents, staff) and deciding it (class teachers, the office). */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!(await getCurrentUser())) redirect(`/sign-in?callbackUrl=/orgs/${slug}/leave`)
  return (
    <OrgShell slug={slug}>
      <LeavePage slug={slug} />
    </OrgShell>
  )
}
