// The platform dashboard's screen, working for this organization (see OwnerProvider).
import { AssignmentEditorPage } from "@/features/admin/components/assignments"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <AssignmentEditorPage id={id} />
}
