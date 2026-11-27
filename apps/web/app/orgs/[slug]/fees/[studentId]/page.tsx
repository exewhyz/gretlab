import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { MyFees } from "@/features/fees/components/my-fees"
import { OrgShell } from "@/features/home/components/org-shell"

export const metadata: Metadata = { title: "Fees", robots: { index: false } }

/** A student's fees ("me": your own), for the student and their parents. */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; studentId: string }>
}) {
  const { slug, studentId } = await params
  if (!(await getCurrentUser()))
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/fees/${studentId}`)
  return (
    <OrgShell slug={slug}>
      <MyFees slug={slug} studentId={studentId} />
    </OrgShell>
  )
}
