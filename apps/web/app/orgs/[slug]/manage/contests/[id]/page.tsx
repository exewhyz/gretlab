// The platform dashboard's screen, working for this organization (see OwnerProvider).
import { ContestEditorPage } from "@/features/admin/components/contests"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ContestEditorPage id={id} />
}
