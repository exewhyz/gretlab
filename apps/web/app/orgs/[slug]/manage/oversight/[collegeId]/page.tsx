import { UniversityCollegeView } from "@/features/university/components/oversight"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; collegeId: string }>
}) {
  const { slug, collegeId } = await params
  return <UniversityCollegeView slug={slug} collegeId={collegeId} />
}
