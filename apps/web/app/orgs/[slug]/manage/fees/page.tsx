import { ManageFees } from "@/features/fees/components/manage-fees"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageFees slug={slug} />
}
