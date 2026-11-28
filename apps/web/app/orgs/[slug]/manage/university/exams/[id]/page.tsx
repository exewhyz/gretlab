import { InternalMarks } from "@/features/university/components/internal-marks"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  return <InternalMarks slug={slug} id={id} />
}
