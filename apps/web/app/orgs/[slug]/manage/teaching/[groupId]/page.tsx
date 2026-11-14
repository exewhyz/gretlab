import { redirect } from "next/navigation"
import { orgPages } from "@/lib/paths"

// The syllabus and class log live on the class's own page, under "Syllabus and log".
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; groupId: string }>
}) {
  const { slug, groupId } = await params
  redirect(orgPages(slug).cls(groupId, "classes"))
}
