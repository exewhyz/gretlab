import { ApplicationPage } from "@/features/admissions/components/admissions"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  return <ApplicationPage slug={slug} id={id} />
}
