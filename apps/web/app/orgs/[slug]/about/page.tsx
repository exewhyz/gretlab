import type { Metadata } from "next"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { OrgShell } from "@/features/home/components/org-shell"
import { homeViews } from "@/features/home/server"
import { OrgProfileView } from "@/features/orgs/components/public"

export const metadata: Metadata = { title: "About the school" }

/**
 * The organization's profile and, for members, what it shares with them (notices, work,
 * problems, contests), their membership (sharing progress, leaving) and rating classes:
 * in the school frame for people with a place here, on its own for visitors.
 */
export default async function AboutPage({
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
        <OrgProfileView slug={slug} />
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
