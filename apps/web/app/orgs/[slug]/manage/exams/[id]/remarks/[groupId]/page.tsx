import { RemarksSheet } from "@/features/results/components/results"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string; groupId: string }>
}) {
  const { slug, id, groupId } = await params
  return <RemarksSheet slug={slug} examId={id} groupId={groupId} />
}
