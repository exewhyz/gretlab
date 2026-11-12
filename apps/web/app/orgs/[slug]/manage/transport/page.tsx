import { ManageTransport } from "@/features/transport/components/transport"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageTransport slug={slug} />
}
