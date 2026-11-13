import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { OrgShell } from "@/features/home/components/org-shell"
import { OpenGroups } from "@/features/orgs/components/open-groups"

export const metadata: Metadata = { title: "Groups", robots: { index: false } }

/** A community's groups: members find them and join or leave themselves. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!(await getCurrentUser())) redirect(`/sign-in?callbackUrl=/orgs/${slug}/groups`)
  return (
    <OrgShell slug={slug}>
      <OpenGroups slug={slug} />
    </OrgShell>
  )
}
