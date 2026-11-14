import { ManageIntegrations } from "@/features/integrations/components/integrations"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageIntegrations slug={slug} />
}
