import { TrainingList } from "@/features/training/components/training"

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <TrainingList slug={slug} />
}
