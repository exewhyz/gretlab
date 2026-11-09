import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { CourseEditor } from "@/features/courses/components/course-pages"

export const metadata: Metadata = { title: "Course", robots: { index: false } }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireStaffPage(`/admin/courses/${id}`)
  return <CourseEditor id={id} />
}
