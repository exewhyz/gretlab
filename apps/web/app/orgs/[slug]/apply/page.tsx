import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { ApplyPage } from "@/features/admissions/components/admissions"
import { getCurrentUser } from "@/features/auth/current-user"

export const metadata: Metadata = { title: "Apply for admission", robots: { index: false } }

/** The admission form, for parents (and students) signed in with their own account. */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!(await getCurrentUser())) redirect(`/sign-in?callbackUrl=/orgs/${slug}/apply`)
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-3xl p-4">
        <ApplyPage slug={slug} />
      </main>
    </div>
  )
}
