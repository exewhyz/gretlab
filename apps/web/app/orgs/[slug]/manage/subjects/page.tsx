import { ManageSubjects } from "@/features/subjects/components/subjects"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageSubjects slug={slug} />
}
