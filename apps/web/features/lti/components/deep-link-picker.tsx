"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { FormMessage, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import type { ApiResult } from "@/lib/api/types"
import type { deepLinkChoices, deepLinkRespond } from "@/features/lti/server"

/** Deep linking: a teacher picks an assignment; the signed answer is posted back to the LMS. */
export function DeepLinkPicker({ id }: { id: string }) {
  const { data, error } = useQuery({
    queryKey: ["lti", "pick", id],
    queryFn: () =>
      api<ApiResult<typeof deepLinkChoices>>(`/lti/deep-link/${id}`),
  })
  const [search, setSearch] = useState("")
  const [answer, setAnswer] = useState<{
    returnUrl: string
    jwt: string
  } | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const choose = useMutation({
    mutationFn: (assignmentId: string) =>
      api<ApiResult<typeof deepLinkRespond>>(`/lti/deep-link/${id}`, {
        body: { assignmentId },
      }),
    onSuccess: setAnswer,
  })
  useEffect(() => {
    if (answer) form.current?.submit()
  }, [answer])
  if (!data) return <Loading error={error} />
  const q = search.trim().toLowerCase()
  const shown = data.assignments.filter(
    (a) => !q || a.title.toLowerCase().includes(q)
  )
  return (
    <div className="grid gap-3" data-testid="deep-link-picker">
      <div>
        <h1 className="text-display-sm text-ink">
          Add a Gretlab assignment to your course
        </h1>
        <p className="text-body-sm text-body">
          It appears in {data.lms} as a link with a gradebook column; students
          open it signed in.
        </p>
      </div>
      <TextInput
        aria-label="Search assignments"
        placeholder="Search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="grid gap-1">
        {shown.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm text-ink">
                {a.title}
              </span>
              <span className="block text-caption">
                Due {formatDateTime(a.dueAt)}
              </span>
            </span>
            <Button
              size="sm"
              aria-label={`Add ${a.title}`}
              disabled={choose.isPending || Boolean(answer)}
              onClick={() => choose.mutate(a.id)}
            >
              Add
            </Button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="text-body-sm text-body">
            No published assignments match.
          </li>
        )}
      </ul>
      {choose.error && (
        <FormMessage message={{ text: choose.error.message, kind: "err" }} />
      )}
      {answer && (
        // The LMS expects the signed answer as a form post (LTI Deep Linking).
        <form
          ref={form}
          method="post"
          action={answer.returnUrl}
          data-testid="deep-link-return"
        >
          <input type="hidden" name="JWT" value={answer.jwt} />
          <p className="text-body-sm text-body">Sending it to {data.lms}…</p>
        </form>
      )}
    </div>
  )
}
