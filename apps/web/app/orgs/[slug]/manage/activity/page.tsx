import { ManageActivity } from "@/features/orgs/components/manage"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageActivity slug={slug} />
}
