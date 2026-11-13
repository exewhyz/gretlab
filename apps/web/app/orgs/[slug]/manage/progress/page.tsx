import { RunsList } from "@/features/runs/components/runs"

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <RunsList slug={slug} />
}
