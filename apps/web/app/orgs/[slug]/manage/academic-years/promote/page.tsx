import { Promotion } from "@/features/records/components/records"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <Promotion slug={slug} />
}
