"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { Field, FormMessage, TextArea } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { classWarnings } from "@/features/classes/warnings"

type Warnings = ApiResult<typeof classWarnings>

/** Early warnings: students who need attention in this class, and a note to them. */
export function NeedsAttention({
  slug,
  groupId,
}: {
  slug: string
  groupId: string
}) {
  const base = `/orgs/${slug}/classes/${groupId}`
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class", groupId, "warnings"],
    queryFn: () => api<Warnings>(`${base}/warnings`),
  })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [writing, setWriting] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  if (!data) return <Loading error={error} />
  const risk = data.students.filter((s) => s.level === "risk").length
  return (
    <section
      className="grid gap-2 rounded-lg border border-hairline bg-card p-3"
      data-testid="needs-attention"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-ink">Needs attention</h2>
          <p className="text-caption">
            {data.students.length === 0
              ? `All ${data.total} students are on track.`
              : `${risk} at risk, ${data.students.length - risk} to watch, of ${data.total} students. From missed work, marks, recent activity and attendance.`}
          </p>
        </div>
        {data.students.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={picked.size === 0}
            onClick={() => setWriting(true)}
          >
            Send a note{picked.size > 0 && ` (${picked.size})`}
          </Button>
        )}
      </div>
      {sent && <FormMessage message={{ text: sent, kind: "ok" }} />}
      {data.students.length > 0 && (
        <ul className="grid gap-1">
          {data.students.map((s) => (
            <li
              key={s.id}
              data-testid="attention-row"
              className="flex flex-wrap items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50"
            >
              <Checkbox
                aria-label={`Choose ${s.name}`}
                checked={picked.has(s.id)}
                onCheckedChange={(checked) =>
                  setPicked((all) => {
                    const next = new Set(all)
                    if (checked) next.add(s.id)
                    else next.delete(s.id)
                    return next
                  })
                }
              />
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  s.level === "risk"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-ink"
                )}
              >
                {s.level === "risk" ? "At risk" : "Watch"}
              </span>
              <span className="min-w-40 text-body-sm text-ink">{s.name}</span>
              <span className="flex-1 text-caption">
                {s.reasons.join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {writing && (
        <NoteDialog
          base={base}
          names={data.students
            .filter((s) => picked.has(s.id))
            .map((s) => s.name)}
          userIds={[...picked]}
          onDone={(message) => {
            setWriting(false)
            if (message) {
              setSent(message)
              setPicked(new Set())
            }
          }}
        />
      )}
    </section>
  )
}

function NoteDialog({
  base,
  names,
  userIds,
  onDone,
}: {
  base: string
  names: string[]
  userIds: string[]
  onDone: (sent?: string) => void
}) {
  const [message, setMessage] = useState("")
  const send = useMutation({
    mutationFn: () =>
      api<{ sent: number }>(`${base}/notes`, { body: { userIds, message } }),
    onSuccess: (r) =>
      onDone(
        `Note sent to ${r.sent} ${r.sent === 1 ? "student" : "students"}.`
      ),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            A note to{" "}
            {names.length === 1 ? names[0] : `${names.length} students`}
          </DialogTitle>
          <DialogDescription>
            It goes to their notifications (and email, if they get it), from
            you. Each sees only their own copy.
          </DialogDescription>
        </DialogHeader>
        <Field label="Note">
          <TextArea
            rows={4}
            aria-label="Note"
            placeholder="I noticed you missed this week's lab. Come and see me on Thursday and we'll catch up."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        {send.error && (
          <FormMessage message={{ text: send.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button
            disabled={!message.trim() || send.isPending}
            onClick={() => send.mutate()}
          >
            Send note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
