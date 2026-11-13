import { TrainingDetail } from "@/features/training/components/training"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; groupId: string; courseId: string }>
}) {
  const { slug, groupId, courseId } = await params
  return <TrainingDetail slug={slug} groupId={groupId} courseId={courseId} />
}
