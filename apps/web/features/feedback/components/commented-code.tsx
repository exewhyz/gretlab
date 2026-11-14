"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Fragment, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"

import { ConfirmButton } from "@/components/confirm"
import { SelectInput, TextArea } from "@/components/form"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import type { ApiResult } from "@/lib/api/types"
import type { mySnippets } from "@/features/feedback/server"

export interface LineComment {
  id: string
  path: string
  line: number
  body: string
  createdAt: string
  author: string | null
}

/**
 * Code with line numbers and the comments left on its lines. Given `onAdd`, the line
 * numbers become buttons that open a comment box under that line.
 */
export function CommentedCode({
  content,
  comments,
  onAdd,
  onDelete,
}: {
  content: string
  comments: LineComment[]
  onAdd?: (line: number, body: string) => Promise<unknown>
  onDelete?: (id: string) => void
}) {
  const [writing, setWriting] = useState<number | null>(null)
  const lines = content.replace(/\n$/, "").split("\n")
  const byLine = new Map<number, LineComment[]>()
  for (const c of comments) {
    byLine.set(c.line, [...(byLine.get(c.line) ?? []), c])
  }
  return (
    <pre
      className="max-h-[32rem] overflow-auto bg-canvas-soft p-3 font-mono text-code text-ink"
      data-testid="commented-code"
    >
      {lines.map((line, index) => {
        const number = index + 1
        const here = byLine.get(number) ?? []
        return (
          <Fragment key={index}>
            <div className="flex">
              {onAdd ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Comment on line ${number}`}
                  title="Comment on this line"
                  className="h-auto w-8 flex-none justify-end rounded-sm p-0 pr-3 font-mono text-code font-normal text-muted-foreground hover:text-primary"
                  onClick={() => setWriting(writing === number ? null : number)}
                >
                  {number}
                </Button>
              ) : (
                <span
                  aria-hidden
                  className="w-8 flex-none pr-3 text-right text-muted-foreground select-none"
                >
                  {number}
                </span>
              )}
              <span className="whitespace-pre">{line || " "}</span>
            </div>
            {here.map((c) => (
              <div
                key={c.id}
                data-testid="line-comment"
                className="my-1 ml-8 grid gap-1 rounded-md border border-primary/40 bg-card px-3 py-2 font-sans text-body-sm whitespace-pre-wrap text-ink"
              >
                <div className="flex flex-wrap items-center gap-x-2 text-caption text-body">
                  <span>{c.author ?? "Teacher"}</span>
                  {c.createdAt && <span>{formatDateTime(c.createdAt)}</span>}
                  {onDelete && (
                    <ConfirmButton
                      variant="ghost"
                      size="xs"
                      className="ml-auto"
                      title="Delete this comment?"
                      description="It's removed from the code."
                      confirmLabel="Delete comment"
                      onConfirm={() => onDelete(c.id)}
                    >
                      Delete
                    </ConfirmButton>
                  )}
                </div>
                {c.body}
              </div>
            ))}
            {writing === number && onAdd && (
              <CommentBox
                line={number}
                onCancel={() => setWriting(null)}
                onSave={(body) =>
                  onAdd(number, body).then(() => setWriting(null))
                }
              />
            )}
          </Fragment>
        )
      })}
    </pre>
  )
}

/** Writing one comment, with the teacher's saved comments to pick from. */
function CommentBox({
  line,
  onCancel,
  onSave,
}: {
  line: number
  onCancel: () => void
  onSave: (body: string) => Promise<unknown>
}) {
  const client = useQueryClient()
  const [body, setBody] = useState("")
  const [keep, setKeep] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const snippets = useQuery({
    queryKey: ["snippets"],
    queryFn: () => api<ApiResult<typeof mySnippets>>("/me/snippets"),
  })
  async function save() {
    if (!body.trim()) return setError("Write the comment first.")
    setSaving(true)
    setError(null)
    try {
      if (keep) {
        await api("/me/snippets", { method: "POST", body: { body } })
        await client.invalidateQueries({ queryKey: ["snippets"] })
      }
      await onSave(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the comment.")
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="my-1 ml-8 grid gap-2 rounded-md border border-hairline bg-card p-2 font-sans whitespace-normal">
      {snippets.data && snippets.data.length > 0 && (
        <SelectInput
          aria-label="Use a saved comment"
          value=""
          onChange={(event) => setBody(event.target.value)}
        >
          <option value="">Use a saved comment…</option>
          {snippets.data.map((s) => (
            <option key={s.id} value={s.body}>
              {s.body.length > 80 ? `${s.body.slice(0, 80)}…` : s.body}
            </option>
          ))}
        </SelectInput>
      )}
      <TextArea
        aria-label={`Comment on line ${line}`}
        rows={3}
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      {error && <p className="text-caption text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-caption text-body">
          <Checkbox checked={keep} onCheckedChange={setKeep} />
          Save for reuse
        </label>
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={saving} onClick={save}>
          Comment
        </Button>
      </div>
    </div>
  )
}
