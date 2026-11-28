import { UniversitySyllabus } from "@/features/university/components/syllabus"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <UniversitySyllabus slug={slug} />
}
