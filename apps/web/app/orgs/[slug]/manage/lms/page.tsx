import { LmsSettings } from "@/features/lti/components/lms-settings"

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <LmsSettings slug={slug} />
}
