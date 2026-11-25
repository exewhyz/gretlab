import { ManageFeedbackRounds } from "@/features/feedback-rounds/components/manage-rounds"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageFeedbackRounds slug={slug} />
}
