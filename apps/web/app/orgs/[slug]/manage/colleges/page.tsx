import { UniversityColleges } from "@/features/university/components/affiliation"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <UniversityColleges slug={slug} />
}
