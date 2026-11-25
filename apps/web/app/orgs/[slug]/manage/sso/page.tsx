import { SsoSettings } from "@/features/sso/components/sso-settings"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <SsoSettings slug={slug} />
}
