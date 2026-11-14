import { ManageHolidays } from "@/features/holidays/components/holidays"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageHolidays slug={slug} />
}
