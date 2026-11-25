import { MyFeedbackResults } from "@/features/feedback-rounds/components/give-feedback"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <MyFeedbackResults slug={slug} />
}
