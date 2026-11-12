import { StudentProfile } from "@/features/records/components/records"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  return <StudentProfile slug={slug} id={id} />
}
