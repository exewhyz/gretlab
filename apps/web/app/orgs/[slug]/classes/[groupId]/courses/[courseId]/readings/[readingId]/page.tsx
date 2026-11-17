import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { ReadingPage } from "@/features/courses/components/reading-page"

export const metadata: Metadata = { title: "Reading", robots: { index: false } }

export default async function Page({
  params,
}: {
  params: Promise<{
    slug: string
    groupId: string
    courseId: string
    readingId: string
  }>
}) {
  const { slug, groupId, courseId, readingId } = await params
  if (!(await getCurrentUser()))
    redirect(
      `/sign-in?callbackUrl=/orgs/${slug}/classes/${groupId}/courses/${courseId}/readings/${readingId}`
    )
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-6xl p-4">
        <ReadingPage
          slug={slug}
          groupId={groupId}
          courseId={courseId}
          readingId={readingId}
        />
      </main>
    </div>
  )
}
