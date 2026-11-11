import { PolicyEditor } from "@/features/notifications/components/policy-editor"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return (
    <PolicyEditor
      path={`/orgs/${slug}/notifications`}
      queryKey={["org", slug, "notifications"]}
      level="organization"
    />
  )
}
