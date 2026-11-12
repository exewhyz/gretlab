import { ManageHostel } from "@/features/hostel/components/hostel"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageHostel slug={slug} />
}
