import { AcademicYears } from "@/features/records/components/records"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <AcademicYears slug={slug} />
}
