import { redirect } from "next/navigation"

// The organization's home is its dashboard; there's no second overview to keep in step.
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/orgs/${slug}`)
}
