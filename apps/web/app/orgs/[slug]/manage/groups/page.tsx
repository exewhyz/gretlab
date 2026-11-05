import { ManageGroups } from "@/features/orgs/components/groups"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageGroups slug={slug} />
}
