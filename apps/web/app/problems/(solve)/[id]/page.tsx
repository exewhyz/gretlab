import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AdSlot } from "@/features/ads/ad-slot"
import { ProblemView } from "@/features/lab/components/problem-view"
import { getPublicProblem } from "@/features/problems/server"
import { getSettings } from "@/features/settings/server"

interface QuestionPageProps {
  params: Promise<{ id: string }>
}

export const revalidate = 60

// Rendered on first visit, then cached. An empty list means builds need no database.
export function generateStaticParams() {
  return []
}

export async function generateMetadata({
  params,
}: QuestionPageProps): Promise<Metadata> {
  const { id } = await params
  const question = await getPublicProblem(id)
  if (!question) return {}
  return {
    title: `${question.title} (${question.level})`,
    description: `Programming practice question from ${question.unit}. Write and test your solution in the browser.`,
  }
}

export default async function QuestionPage({ params }: QuestionPageProps) {
  const { id } = await params
  const [question, settings] = await Promise.all([
    getPublicProblem(id),
    getSettings(),
  ])
  if (!question) notFound()

  return (
    <ProblemView
      question={question}
      footer={
        settings["ads.enabled"] ? (
          <AdSlot placement="problemEnd" className="mt-6" />
        ) : undefined
      }
    />
  )
}
