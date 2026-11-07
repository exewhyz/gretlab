// The platform dashboard's screen, working for this organization (see OwnerProvider).
import { ContestEditorPage } from "@/features/admin/components/contests"

/** `?for=<group>`: started from a class page, so it's for that class. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ for?: string }>
}) {
  const { for: forClass } = await searchParams
  return <ContestEditorPage id={null} forClass={forClass ?? null} />
}
