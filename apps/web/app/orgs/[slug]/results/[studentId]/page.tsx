import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { OrgShell } from "@/features/home/components/org-shell"
import { ReportCard } from "@/features/results/components/results"

export const metadata: Metadata = {
  title: "Report card",
  robots: { index: false },
}

/** A student's report card ("me": your own), for the student, their parents and staff. */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; studentId: string }>
}) {
  const { slug, studentId } = await params
  if (!(await getCurrentUser()))
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/results/${studentId}`)
  return (
    <OrgShell slug={slug}>
      <ReportCard slug={slug} studentId={studentId} />
    </OrgShell>
  )
}
