"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { importLinks, searchStudents } from "@/features/parents/server"
import type { listLinks } from "@/features/parents/server"

interface Link {
  id: string
  relation: string
  parent: { name: string | null; email: string }
  student: { id: string; name: string; email: string; classes: string[] }
  canRemove: boolean
}

type Student = ApiResult<typeof searchStudents>[number]

const RELATIONS = ["Mother", "Father", "Guardian", "Grandparent", "Other"]

/** Manage › Parents: who's linked to which student; link one, or many from a list. */
export function ManageParents({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "parents"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<ApiResult<typeof listLinks>>(`/orgs/${slug}/parents`),
  })
  const [filter, setFilter] = useState("")
  const [dialog, setDialog] = useState<"add" | "import" | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/parents/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  if (!data) return <Loading error={error} />
  const term = filter.trim().toLowerCase()
  const shown = term
    ? data.links.filter((l) =>
        [
          l.student.name,
          l.student.email,
          l.parent.name ?? "",
          l.parent.email,
          ...l.student.classes,
        ]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
    : data.links
  const done = () => {
    void client.invalidateQueries({ queryKey: key })
  }
  return (
    <>
      <PageTitle
        action={
          data.can.link && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDialog("import")}>
                Add from a list
              </Button>
              <Button onClick={() => setDialog("add")}>Add parent</Button>
            </div>
          )
        }
      >
        Parents
      </PageTitle>
      <p className="mb-4 max-w-2xl text-body-sm text-body">
        A parent signs in with their own email and sees only their child:
        attendance, timetable, work and marks, and class notices. They get a
        copy of their child&apos;s notifications, and a note when the child is
        marked absent. Parents aren&apos;t members and hold no role.
      </p>
      {data.links.length > 0 && (
        <div className="mb-3 max-w-sm">
          <TextInput
            aria-label="Search parents and students"
            placeholder="Search by name, email or class"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      {remove.error && (
        <FormMessage message={{ text: remove.error.message, kind: "err" }} />
      )}
      {data.links.length === 0 ? (
        <p className="text-body-sm text-body">No parents are linked yet.</p>
      ) : (
        <ul
          className="divide-y divide-hairline rounded-lg border border-hairline bg-card"
          data-testid="parent-links"
        >
          {shown.map((l) => (
            <li
              key={l.id}
              data-testid="parent-link"
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-body-sm"
            >
              <div className="min-w-0">
                <div className="font-medium text-ink">
                  {l.parent.name || l.parent.email}
                  {l.relation && (
                    <span className="font-normal text-body">
                      {" "}
                      · {l.relation}
                    </span>
                  )}
                </div>
                {l.parent.name && (
                  <div className="truncate text-xs text-body">
                    {l.parent.email}
                  </div>
                )}
              </div>
              <div className="min-w-0 sm:text-right">
                <div className="text-ink">of {l.student.name}</div>
                <div className="truncate text-xs text-body">
                  {l.student.classes.join(", ") || "No class yet"}
                </div>
              </div>
              {l.canRemove && (
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  title={`Unlink ${l.parent.name || l.parent.email}?`}
                  description={`They'll no longer see ${l.student.name}. Their account stays.`}
                  confirmLabel="Unlink"
                  tone="destructive"
                  onConfirm={() => remove.mutate(l.id)}
                >
                  Unlink
                </ConfirmButton>
              )}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-4 py-3 text-body-sm text-body">
              Nothing matches.
            </li>
          )}
        </ul>
      )}
      {dialog === "add" && (
        <AddParent
          slug={slug}
          onDone={(changed) => (setDialog(null), changed && done())}
        />
      )}
      {dialog === "import" && (
        <ImportParents
          slug={slug}
          onDone={(changed) => (setDialog(null), changed && done())}
        />
      )}
    </>
  )
}

function AddParent({
  slug,
  onDone,
}: {
  slug: string
  onDone: (changed: boolean) => void
}) {
  const [q, setQ] = useState("")
  const [student, setStudent] = useState<Student | null>(null)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [relation, setRelation] = useState("")
  const search = useQuery({
    queryKey: ["org", slug, "parent-students", q.trim()],
    queryFn: () =>
      api<Student[]>(
        `/orgs/${slug}/parents/students?q=${encodeURIComponent(q.trim())}`
      ),
    enabled: !student && q.trim().length >= 2,
  })
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/parents`, {
        body: { studentId: student!.id, email, name, relation },
      }),
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add parent</DialogTitle>
          <DialogDescription>
            They sign in with this email. If they have no account yet, it waits
            for their first sign-in.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {student ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-hairline px-3 py-2 text-body-sm">
              <div className="min-w-0">
                <div className="font-medium text-ink">{student.name}</div>
                <div className="truncate text-xs text-body">
                  {student.classes.join(", ") || student.email}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStudent(null)}
              >
                Change
              </Button>
            </div>
          ) : (
            <Field label="Student">
              <TextInput
                placeholder="Search by name or email"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </Field>
          )}
          {!student && q.trim().length >= 2 && (
            <ul
              className="max-h-48 overflow-y-auto rounded-md border border-hairline"
              aria-label="Students found"
            >
              {(search.data ?? []).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full px-3 py-2 text-left text-body-sm hover:bg-muted"
                    )}
                    onClick={() => setStudent(s)}
                  >
                    <span className="font-medium text-ink">{s.name}</span>{" "}
                    <span className="text-xs text-body">
                      {s.classes.join(", ") || s.email}
                    </span>
                  </button>
                </li>
              ))}
              {search.data?.length === 0 && (
                <li className="px-3 py-2 text-body-sm text-body">
                  No students match.
                </li>
              )}
            </ul>
          )}
          <Field label="Parent's email">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Parent's name">
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Relation">
              <SelectInput
                value={relation}
                onChange={(e) => setRelation(e.target.value)}
              >
                <option value="">—</option>
                {RELATIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </SelectInput>
            </Field>
          </div>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button
            disabled={!student || !email || save.isPending}
            onClick={() => save.mutate()}
          >
            Link parent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ImportResult = ApiResult<typeof importLinks>

function ImportParents({
  slug,
  onDone,
}: {
  slug: string
  onDone: (changed: boolean) => void
}) {
  const [text, setText] = useState("")
  const rows = text
    .split("\n")
    .map((line) => line.split(/\t|,/).map((c) => c.trim()))
    .filter((c) => c.some(Boolean))
    // A header line from a spreadsheet is skipped.
    .filter((c) => !/student/i.test(c[0] ?? "") || c[0]!.includes("@"))
    .map(
      ([
        studentEmail = "",
        parentEmail = "",
        parentName = "",
        relation = "",
      ]) => ({
        studentEmail,
        parentEmail,
        parentName,
        relation,
      })
    )
  const save = useMutation({
    mutationFn: () =>
      api<ImportResult>(`/orgs/${slug}/parents/import`, { body: { rows } }),
  })
  const result = save.data
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onDone(Boolean(result?.linked))}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add parents from a list</DialogTitle>
          <DialogDescription>
            One per line: student email, parent email, parent name, relation.
            Paste from a spreadsheet or separate with commas. A student may have
            several parents.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-2 text-body-sm" data-testid="import-report">
            <p className="text-ink">
              Linked {result.linked}
              {result.failed ? `, ${result.failed} not linked:` : "."}
            </p>
            <ul className="max-h-60 overflow-y-auto">
              {result.report
                .filter((r) => r.result === "error")
                .map((r) => (
                  <li key={r.line} className="text-destructive">
                    Line {r.line}: {r.note}
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-2">
            <TextArea
              aria-label="Parents list"
              rows={8}
              placeholder={
                "asha@school.in, ravi.k@gmail.com, Ravi Kumar, Father"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-caption">{rows.length} lines</p>
            {save.error && (
              <FormMessage
                message={{ text: save.error.message, kind: "err" }}
              />
            )}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onDone(result.linked > 0)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onDone(false)}>
                Cancel
              </Button>
              <Button
                disabled={rows.length === 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                Link {rows.length || ""} parents
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
