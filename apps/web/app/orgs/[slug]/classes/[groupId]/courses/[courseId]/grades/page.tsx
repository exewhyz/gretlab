import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { CourseGrades } from "@/features/courses/components/course-grades"

export const metadata: Metadata = {
  title: "Course grades",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; groupId: string; courseId: string }>
}) {
  const { slug, groupId, courseId } = await params
  if (!(await getCurrentUser()))
    redirect(
      `/sign-in?callbackUrl=/orgs/${slug}/classes/${groupId}/courses/${courseId}/grades`
    )
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-6xl p-4">
        <CourseGrades slug={slug} groupId={groupId} courseId={courseId} />
      </main>
    </div>
  )
}
