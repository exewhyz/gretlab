import { UniversityOversight } from "@/features/university/components/oversight"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <UniversityOversight slug={slug} />
}
