import { OrgPlagiarism } from "@/features/plagiarism/components/org-plagiarism"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <OrgPlagiarism slug={slug} />
}
