import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { CheckpointPage } from "@/features/courses/components/checkpoint-page"

export const metadata: Metadata = {
  title: "Course work",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{
    slug: string
    groupId: string
    courseId: string
    checkpointId: string
  }>
}) {
  const { slug, groupId, courseId, checkpointId } = await params
  if (!(await getCurrentUser()))
    redirect(
      `/sign-in?callbackUrl=/orgs/${slug}/classes/${groupId}/courses/${courseId}/checkpoints/${checkpointId}`
    )
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-4xl p-4">
        <CheckpointPage
          slug={slug}
          groupId={groupId}
          courseId={courseId}
          checkpointId={checkpointId}
        />
      </main>
    </div>
  )
}
