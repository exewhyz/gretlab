import { QuestionEditorPage } from "@/features/questions/components/question-editor"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <QuestionEditorPage id={id} />
}
