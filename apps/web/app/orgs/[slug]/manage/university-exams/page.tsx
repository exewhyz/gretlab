import { UniversityExams } from "@/features/university/components/exams"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <UniversityExams slug={slug} />
}
