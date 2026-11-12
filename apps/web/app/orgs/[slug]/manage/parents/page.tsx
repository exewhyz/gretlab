import { ManageParents } from "@/features/parents/components/manage-parents"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageParents slug={slug} />
}
