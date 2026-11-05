import { permanentRedirect } from "next/navigation"

/** Problems used to live here. Old links and bookmarks keep working. */
export default async function OldQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  permanentRedirect(`/problems/${id}`)
}
