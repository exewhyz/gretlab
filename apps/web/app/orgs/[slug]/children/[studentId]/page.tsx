import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { ChildPage } from "@/features/parents/components/children"

export const metadata: Metadata = {
  title: "My child",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; studentId: string }>
}) {
  const { slug, studentId } = await params
  if (!(await getCurrentUser())) {
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/children/${studentId}`)
  }
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <ChildPage slug={slug} studentId={studentId} />
      </main>
    </div>
  )
}
