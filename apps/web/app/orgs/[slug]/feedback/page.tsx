import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { GiveFeedback } from "@/features/feedback-rounds/components/give-feedback"

export const metadata: Metadata = {
  title: "Feedback",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!(await getCurrentUser()))
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/feedback`)
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-3xl p-4">
        <GiveFeedback slug={slug} />
      </main>
    </div>
  )
}
