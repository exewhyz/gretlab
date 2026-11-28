import { UniversityRegistrations } from "@/features/university/components/registrations"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <UniversityRegistrations slug={slug} />
}
