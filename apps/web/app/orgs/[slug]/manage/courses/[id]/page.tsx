// The platform dashboard's screen, working for this organization (see OwnerProvider).
import { CourseEditor } from "@/features/courses/components/course-pages"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CourseEditor id={id} />
}
