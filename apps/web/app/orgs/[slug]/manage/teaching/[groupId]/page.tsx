import { GroupTeachingView } from "@/features/teaching/components/teaching"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; groupId: string }>
}) {
  const { slug, groupId } = await params
  return <GroupTeachingView slug={slug} groupId={groupId} />
}
