import { RunProgress } from "@/features/runs/components/runs"

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  return <RunProgress slug={slug} runId={id} />
}
