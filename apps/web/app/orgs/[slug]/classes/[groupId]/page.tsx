import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { ClassPage } from "@/features/classes/components/class-page"

export const metadata: Metadata = { title: "Class", robots: { index: false } }

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; groupId: string }>
  searchParams: Promise<{ tab?: string; thread?: string }>
}) {
  const { slug, groupId } = await params
  const { tab, thread } = await searchParams
  if (!(await getCurrentUser()))
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/classes/${groupId}`)
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-6xl p-4">
        <ClassPage slug={slug} groupId={groupId} tab={tab} thread={thread} />
      </main>
    </div>
  )
}
