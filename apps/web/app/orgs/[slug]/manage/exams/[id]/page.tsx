import { ExamPage } from "@/features/results/components/results"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  return <ExamPage slug={slug} examId={id} />
}
