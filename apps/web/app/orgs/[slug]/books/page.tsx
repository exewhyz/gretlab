import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { MemberLibrary } from "@/features/books/components/library"

export const metadata: Metadata = { title: "Library", robots: { index: false } }

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!(await getCurrentUser()))
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/books`)
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <MemberLibrary slug={slug} />
      </main>
    </div>
  )
}
