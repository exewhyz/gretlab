import { UniversityExamPage } from "@/features/university/components/exams"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  return <UniversityExamPage slug={slug} id={id} />
}
