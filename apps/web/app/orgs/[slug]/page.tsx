import type { Metadata } from "next"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { OrgHome } from "@/features/home/components/home"
import { OrgShell } from "@/features/home/components/org-shell"
import { homeViews } from "@/features/home/server"
import { OrgProfileView } from "@/features/orgs/components/public"

export const metadata: Metadata = { title: "Organization" }

/**
 * The school's home for everyone with a place in it (admin, teacher, student, parent:
 * the dashboards in the school frame); its public profile for everyone else.
 */
export default async function OrgPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const user = await getCurrentUser()
  const views = user ? await homeViews(slug, user) : []
  if (views.length > 0) {
    return (
      <OrgShell slug={slug}>
        <OrgHome slug={slug} />
      </OrgShell>
    )
  }
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <OrgProfileView slug={slug} />
      </main>
    </div>
  )
}
