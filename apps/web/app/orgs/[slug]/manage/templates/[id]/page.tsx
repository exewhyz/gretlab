// The platform dashboard's screen, working for this organization (see OwnerProvider).
import { TemplatePage } from "@/features/templates/components/templates-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TemplatePage id={id === "new" ? null : id} />
}
