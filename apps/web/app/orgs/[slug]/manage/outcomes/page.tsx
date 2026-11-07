import { ManageOutcomes } from "@/features/outcomes/components/program-outcomes"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageOutcomes slug={slug} />
}
