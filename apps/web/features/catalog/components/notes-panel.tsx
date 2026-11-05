"use client"

import { Textarea } from "@workspace/ui/components/textarea"
import { useMutation, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { useQuestionSession } from "@/features/lab/hooks/use-question-session"
import { api } from "@/lib/api/client"

const SAVE_DELAY_MS = 800

/** Private notes on this problem, saved to the account as you type. */
export function NotesPanel() {
  const { question, viewer } = useQuestionSession()
  const pathname = usePathname()
  const { data } = useQuery({
    queryKey: ["note", question.id],
    queryFn: () => api<{ text: string }>(`/problems/${question.id}/note`),
    enabled: Boolean(viewer?.user),
  })
  const [text, setText] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const save = useMutation({
    mutationFn: (value: string) =>
      api(`/problems/${question.id}/note`, {
        method: "PUT",
        body: { text: value },
      }),
  })
  useEffect(() => () => clearTimeout(timer.current), [])

  const body = "flex min-h-0 flex-1 flex-col gap-2 p-4 text-body-sm text-body"
  if (viewer && !viewer.user) {
    return (
      <div className={body}>
        <p>
          <Link
            className="underline underline-offset-2 hover:text-ink"
            href={`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`}
          >
            Sign in
          </Link>{" "}
          to keep private notes on problems.
        </p>
      </div>
    )
  }
  const value = text ?? data?.text ?? ""
  return (
    <div className={body}>
      <label htmlFor="problem-note" className="text-caption">
        Only you can see these notes.
      </label>
      <Textarea
        id="problem-note"
        className="min-h-48 flex-1 resize-none bg-card p-3 text-body-sm text-ink"
        placeholder="Approach, edge cases, what tripped you up…"
        value={value}
        disabled={!data}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => save.mutate(next), SAVE_DELAY_MS)
        }}
      />
      <span role="status" className="text-xs">
        {save.isPending
          ? "Saving…"
          : save.isSuccess
            ? "Saved"
            : save.isError
              ? "Couldn't save"
              : ""}
      </span>
    </div>
  )
}
