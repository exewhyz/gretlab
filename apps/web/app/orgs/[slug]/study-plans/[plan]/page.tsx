import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { OrgPlan } from "@/features/catalog/components/org-plans"

export const metadata: Metadata = {
  title: "Study plan",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; plan: string }>
}) {
  const { slug, plan } = await params
  if (!(await getCurrentUser()))
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/study-plans/${plan}`)
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-3xl p-4">
        <OrgPlan slug={slug} plan={plan} />
      </main>
    </div>
  )
}
