"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { Check, FormMessage, TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { AssignmentEditorPage } from "@/features/admin/components/assignments"
import { toLocalInput } from "@/features/admin/components/contests"
import { Card, Loading, PageTitle, Table } from "@/features/admin/components/shell"
import { useOwner } from "@/features/admin/owner"
import { ShareDialog } from "@/features/library/components/library-page"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { useGroups } from "@/features/orgs/components/manage-shared"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

/*
 * Templates: assignments and exams written once and used for many classes, each use with
 * its own dates. The editor is the assignment form in template mode.
 */

type Sharing = "everyone" | "selected" | "owner"

interface TemplateRow {
  id: string
  title: string
  published: boolean
  sharing: Sharing
  exam: boolean
  problems: number
  questions: number
  points: number
  uses: number
  source: "ours" | "platform" | "shared"
  owner: string
  copiedFrom: string | null
}

interface Template {
  id: string
  title: string
  description: string
  editable: boolean
  published: boolean
  sharing: Sharing
  exam: { minutes: number | null } | null
  problems: { problemId: string; points: number }[]
  questions: { questionId: string; points: number }[]
  uses: {
    id: string
    slug: string
    title: string
    audience: string[][]
    opensAt: string
    dueAt: string
    published: boolean
    opened: boolean
  }[]
}

const SHARING_LABEL: Record<Sharing, string> = {
  everyone: "Every college",
  selected: "Chosen colleges",
  owner: "Staff only",
}

export function TemplatesPage() {
  const owner = useOwner()
  const platform = owner.orgSlug === null
  const { data, error } = useQuery({
    queryKey: owner.key("templates"),
    queryFn: () => api<TemplateRow[]>(owner.api("/templates")),
  })
  const [using, setUsing] = useState<TemplateRow | null>(null)
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle
        action={
          <Link href={owner.page("/templates/new")} className={cn(buttonVariants({ size: "sm" }))}>
            New template
          </Link>
        }
      >
        Templates
      </PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        {platform
          ? "Assignments and exams written once. Share them with colleges, who use them for their classes with their own dates. Until a use opens, your edits reach it."
          : "Assignments and exams written once and used for many classes, each with its own dates. Until a use opens, edits to the template reach it. Templates the platform shares with you are here too. Any assignment can be saved as a template from its page."}
      </p>
      {data.length === 0 ? (
        <Card>No templates yet.</Card>
      ) : (
        <Table
          headers={["Template", "Kind", "Problems", "Questions", "Points", platform ? "Shared with" : "Source", "Uses", ""]}
        >
          {data.map((t) => (
            <tr key={t.id} data-testid="template-row">
              <td>
                <Link
                  href={owner.page(`/templates/${t.id}`)}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {t.title}
                </Link>
                {!t.published && <span className="ml-2 text-xs">Draft</span>}
                {t.copiedFrom && <span className="ml-1 text-xs text-body">(copy)</span>}
              </td>
              <td className="text-caption">{t.exam ? "Exam" : "Assignment"}</td>
              <td className="tabular-nums">{t.problems}</td>
              <td className="tabular-nums">{t.questions}</td>
              <td className="tabular-nums">{t.points}</td>
              <td className="text-caption">
                {platform ? SHARING_LABEL[t.sharing] : t.source === "ours" ? "Ours" : t.owner}
              </td>
              <td className="tabular-nums">{t.uses}</td>
              <td className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!t.published}
                  aria-label={`Use ${t.title}`}
                  onClick={() => setUsing(t)}
                >
                  Use…
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {using && <ApplyDialog template={using} onDone={() => setUsing(null)} />}
    </>
  )
}

/** A template: its editor (or, when shared with us, a summary to use or copy) and its uses. */
export function TemplatePage({ id }: { id: string | null }) {
  const owner = useOwner()
  const client = useQueryClient()
  const router = useRouter()
  const platform = owner.orgSlug === null
  const { data: viewer } = useViewer()
  const canShare = platform && (viewer?.user?.platform.permissions ?? []).includes("platform.library.share")
  const { data, error } = useQuery({
    queryKey: owner.key("template", id),
    queryFn: () => api<Template>(owner.api(`/templates/${id}`)),
    enabled: id !== null,
  })
  const [dialog, setDialog] = useState<"use" | "share" | null>(null)
  const copy = useMutation({
    mutationFn: () => api<{ id: string }>(owner.api(`/templates/${id}/copy`), { body: {} }),
    onSuccess: (row) => {
      void client.invalidateQueries({ queryKey: owner.key("templates") })
      router.push(owner.page(`/templates/${row.id}`))
    },
  })
  if (id === null) return <AssignmentEditorPage id={null} template />
  if (!data) return <Loading error={error} />
  const row = {
    id: data.id,
    title: data.title,
    published: data.published,
    exam: data.exam !== null,
  }
  return (
    <div className="grid gap-4">
      <nav className="text-caption">
        <Link href={owner.page("/templates")} className="hover:text-ink">
          Templates
        </Link>
      </nav>
      {data.editable ? (
        <div>
          <AssignmentEditorPage id={id} template />
        </div>
      ) : (
        <>
          <PageTitle
            action={
              !platform && (
                <Button size="sm" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate()}>
                  Copy to change it
                </Button>
              )
            }
          >
            {data.title}
          </PageTitle>
          <Card className="grid gap-1 text-body-sm">
            {data.description && <p>{data.description}</p>}
            <p>
              {data.exam ? "Exam" : "Assignment"} · {data.problems.length} problems ·{" "}
              {data.questions.length} questions · shared with you. Use it as it is, or copy it to
              change it.
            </p>
            {copy.error && <FormMessage message={{ text: copy.error.message, kind: "err" }} />}
          </Card>
        </>
      )}
      <Card className="grid gap-3" data-testid="template-uses">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-display-sm text-ink">Uses</h2>
          <span className="flex gap-2">
            {canShare && data.editable && (
              <Button size="sm" variant="outline" onClick={() => setDialog("share")}>
                Share…
              </Button>
            )}
            <Button size="sm" disabled={!data.published} onClick={() => setDialog("use")}>
              {platform ? "Use…" : "Use for classes…"}
            </Button>
          </span>
        </div>
        {data.uses.length === 0 ? (
          <p className="text-body-sm text-body">
            {data.published ? "Not used yet." : "Mark it ready (Save template) to use it."}
          </p>
        ) : (
          <Table headers={["Assignment", "Opens", "Due", "Template changes"]}>
            {data.uses.map((u) => (
              <tr key={u.id} data-testid="template-use">
                <td>
                  <Link
                    href={owner.page(`/assignments/${u.id}`)}
                    className="font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {u.slug}
                  </Link>
                  {!u.published && <span className="ml-2 text-xs">Draft</span>}
                </td>
                <td>{formatDateTime(u.opensAt)}</td>
                <td>{formatDateTime(u.dueAt)}</td>
                <td className="text-caption">{u.opened ? "Opened: kept as it was" : "Gets them until it opens"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {dialog === "use" && (
        <ApplyDialog
          template={row}
          onDone={() => {
            setDialog(null)
            void client.invalidateQueries({ queryKey: owner.key("template", id) })
          }}
        />
      )}
      {dialog === "share" && (
        <ShareDialog
          items={[{ kind: "template", id: data.id, title: data.title }]}
          onDone={() => {
            setDialog(null)
            void client.invalidateQueries({ queryKey: owner.key("templates") })
          }}
        />
      )}
    </div>
  )
}

interface UseRow {
  key: number
  groupId: string
  opensAt: string
  dueAt: string
}

let nextKey = 0
const newRow = (): UseRow => {
  const due = new Date(Date.now() + 7 * 24 * 3600_000)
  due.setHours(23, 59, 0, 0)
  return { key: nextKey++, groupId: "", opensAt: toLocalInput(new Date()), dueAt: toLocalInput(due) }
}

/** Uses a template: one assignment per class, each with its own dates. */
function ApplyDialog({
  template,
  onDone,
}: {
  template: { id: string; title: string; exam: boolean }
  onDone: () => void
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const platform = owner.orgSlug === null
  const groups = useGroups(owner.orgSlug ?? "")
  const [rows, setRows] = useState<UseRow[]>([newRow()])
  const [published, setPublished] = useState(false)
  const apply = useMutation({
    mutationFn: () =>
      api<{ created: { id: string; slug: string; title: string }[] }>(
        owner.api(`/templates/${template.id}/use`),
        {
          body: {
            published,
            uses: rows.map((r) => ({
              groupId: platform ? null : r.groupId || null,
              opensAt: new Date(r.opensAt),
              dueAt: new Date(r.dueAt),
            })),
          },
        }
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin"] })
      void client.invalidateQueries({ queryKey: ["assignments"] })
    },
  })
  const update = (key: number, patch: Partial<UseRow>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const ready = rows.every((r) => r.opensAt && r.dueAt && (platform || r.groupId))

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" data-testid="apply-dialog">
        <DialogHeader>
          <DialogTitle>Use {template.title}</DialogTitle>
          <DialogDescription>
            {platform
              ? "Each use is an assignment for everyone on the platform, with its own dates."
              : "Each class gets its own assignment with its own dates and gradebook."}{" "}
            {template.exam && "Set each lab's networks on its assignment afterwards."}
          </DialogDescription>
        </DialogHeader>
        {apply.data ? (
          <div className="grid gap-2 text-body-sm" data-testid="apply-done">
            <p className="text-ink">
              Made {apply.data.created.length}{" "}
              {apply.data.created.length === 1 ? "assignment" : "assignments"}:
            </p>
            <ul className="grid gap-1">
              {apply.data.created.map((c) => (
                <li key={c.id}>
                  <Link href={owner.page(`/assignments/${c.id}`)} className="underline underline-offset-2">
                    /assignments/{c.slug}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {!platform && !groups.data && <Loading error={groups.error} />}
            <ol className="grid gap-2">
              {rows.map((r, index) => (
                <li
                  key={r.key}
                  data-testid="apply-row"
                  className="grid gap-2 rounded-md border border-hairline p-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
                >
                  {platform ? (
                    <span className="self-center text-caption">Use {index + 1}</span>
                  ) : (
                    groups.data && (
                      <label className="grid gap-1 text-caption">
                        Class
                        <GroupPicker
                          label={`Class for use ${index + 1}`}
                          placeholder="Choose a class"
                          groups={groups.data.groups}
                          levels={groups.data.levels}
                          value={r.groupId}
                          onChange={(groupId) => update(r.key, { groupId })}
                        />
                      </label>
                    )
                  )}
                  <label className="grid gap-1 text-caption">
                    Opens
                    <TextInput
                      type="datetime-local"
                      aria-label={`Opens, use ${index + 1}`}
                      value={r.opensAt}
                      onChange={(e) => update(r.key, { opensAt: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-caption">
                    Due
                    <TextInput
                      type="datetime-local"
                      aria-label={`Due, use ${index + 1}`}
                      value={r.dueAt}
                      onChange={(e) => update(r.key, { dueAt: e.target.value })}
                    />
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={rows.length === 1}
                    aria-label={`Remove use ${index + 1}`}
                    onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={rows.length >= 50}
              onClick={() => setRows([...rows, { ...newRow(), opensAt: rows.at(-1)!.opensAt, dueAt: rows.at(-1)!.dueAt }])}
            >
              {platform ? "+ Another use" : "+ Another class"}
            </Button>
            <Check checked={published} onCheckedChange={setPublished} label="Publish them now (students see them)" />
            {apply.error && <FormMessage message={{ text: apply.error.message, kind: "err" }} />}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            {apply.data ? "Close" : "Cancel"}
          </Button>
          {!apply.data && (
            <Button disabled={!ready || apply.isPending} onClick={() => apply.mutate()}>
              {rows.length === 1 ? "Make the assignment" : `Make ${rows.length} assignments`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
