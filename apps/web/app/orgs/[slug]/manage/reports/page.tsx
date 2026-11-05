import { OrgReports } from "@/features/teaching/components/teaching"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <OrgReports slug={slug} />
}
