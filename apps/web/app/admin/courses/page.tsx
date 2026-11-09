import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { CoursesPage } from "@/features/courses/components/course-pages"

export const metadata: Metadata = { title: "Courses", robots: { index: false } }

export default async function Page() {
  await requireStaffPage("/admin/courses")
  return <CoursesPage />
}
