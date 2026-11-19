import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { OrgShell } from "@/features/home/components/org-shell"
import { MemberProfile } from "@/features/profile/components/member-profile"

export const metadata: Metadata = { title: "Profile", robots: { index: false } }

/** Someone's profile in this organization; "me" for your own. */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  if (!(await getCurrentUser()))
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/profile/${id}`)
  return (
    <OrgShell slug={slug}>
      <MemberProfile slug={slug} id={id} />
    </OrgShell>
  )
}
