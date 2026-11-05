import { ManageMembers } from "@/features/orgs/components/manage"

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const [{ slug }, { status }] = await Promise.all([params, searchParams])
  return <ManageMembers slug={slug} initialStatus={status} />
}
