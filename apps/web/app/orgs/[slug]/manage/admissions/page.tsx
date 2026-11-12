import { Admissions } from "@/features/admissions/components/admissions"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <Admissions slug={slug} />
}
