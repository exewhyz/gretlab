// The platform dashboard's screen, working for this organization (see OwnerProvider).
import { ProblemEditorPage } from "@/features/admin/components/problem-editor"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ProblemEditorPage id={id} />
}
