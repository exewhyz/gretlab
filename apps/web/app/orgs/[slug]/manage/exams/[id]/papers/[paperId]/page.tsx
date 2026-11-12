import { MarksSheet } from "@/features/results/components/results"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string; paperId: string }>
}) {
  const { slug, id, paperId } = await params
  return <MarksSheet slug={slug} examId={id} paperId={paperId} />
}
