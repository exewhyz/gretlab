"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { ConfirmButton } from "@/components/confirm"
import { Check, Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { Loading, PageTitle, Table } from "@/features/admin/components/shell"
import { useOwner } from "@/features/admin/owner"
import { ShareDialog } from "@/features/library/components/library-page"
import { KIND_LABEL } from "@/features/questions/components/question-editor"
import { api } from "@/lib/api/client"

/*
 * Courses as their owner writes them: a list, and one course's outline of modules. Each
 * module is edited in a dialog; the outline is saved as a whole.
 */

type Sharing = "everyone" | "selected" | "owner"

interface CourseRow {
  id: string
  title: string
  description: string
  published: boolean
  sharing: Sharing
  source: "ours" | "platform" | "shared"
  owner: string
  modules: number
  items: number
  classes: number
  copiedFrom: string | null
}

interface Item {
  kind: "problem" | "question"
  id: string
  title: string
  detail: string
}

interface Module {
  id?: string
  /** A key for new modules, which have no id yet. */
  key: string
  title: string
  summary: string
  openAfterDays: number | null
  afterPrevious: boolean
  items: Item[]
}

interface Course {
  id: string
  orgId: string | null
  title: string
  description: string
  published: boolean
  sharing: Sharing
  editable: boolean
  updatedAt: string
  modules: (Omit<Module, "key"> & { id: string })[]
}

const SHARING_LABEL: Record<Sharing, string> = {
  everyone: "Every college",
  selected: "Chosen colleges",
  owner: "Staff only",
}

const itemDetail = (item: Item) =>
  item.kind === "problem"
    ? `Problem · ${item.detail}`
    : `Question · ${KIND_LABEL[item.detail as keyof typeof KIND_LABEL] ?? item.detail}`

const releaseLabel = (m: Pick<Module, "openAfterDays" | "afterPrevious">) =>
  [
    m.openAfterDays ? `Opens on day ${m.openAfterDays + 1}` : "Opens at the start",
    m.afterPrevious ? "after the module before" : null,
  ]
    .filter(Boolean)
    .join(", ")

export function CoursesPage() {
  const owner = useOwner()
  const platform = owner.orgSlug === null
  const { data, error } = useQuery({
    queryKey: owner.key("courses"),
    queryFn: () => api<CourseRow[]>(owner.api("/courses")),
  })
  const [creating, setCreating] = useState(false)
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle action={<Button onClick={() => setCreating(true)}>New course</Button>}>Courses</PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        {platform
          ? "A course is an outline of modules, each with problems and questions from the library. Write it once; colleges give it to their classes."
          : "A course is an outline of modules with problems and questions from your library. Write it once and give it to any number of classes from their Course tab. Courses the platform shares with you are here too."}
      </p>
      <Table
        headers={["Course", "Modules", "Items", platform ? "Shared with" : "Source", "Classes", "Status"]}
      >
        {data.map((c) => (
          <tr key={c.id} data-testid="course-row">
            <td>
              <Link
                href={owner.page(`/courses/${c.id}`)}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {c.title}
              </Link>
              {c.copiedFrom && <span className="ml-1 text-xs text-body">(copy)</span>}
            </td>
            <td className="tabular-nums">{c.modules}</td>
            <td className="tabular-nums">{c.items}</td>
            <td className="text-caption">
              {platform ? SHARING_LABEL[c.sharing] : c.source === "ours" ? "Ours" : c.owner}
            </td>
            <td className="tabular-nums">{c.classes}</td>
            <td className="text-caption">{c.published ? "Ready" : "Draft"}</td>
          </tr>
        ))}
      </Table>
      {data.length === 0 && <p className="mt-2 text-body-sm text-body">No courses yet.</p>}
      {creating && <DetailsDialog course={null} onDone={() => setCreating(false)} />}
    </>
  )
}

/** A course's name, description and whether it's ready for classes. */
function DetailsDialog({ course, onDone }: { course: Course | null; onDone: () => void }) {
  const owner = useOwner()
  const client = useQueryClient()
  const router = useRouter()
  const [title, setTitle] = useState(course?.title ?? "")
  const [description, setDescription] = useState(course?.description ?? "")
  const [published, setPublished] = useState(course?.published ?? false)
  const save = useMutation({
    mutationFn: () =>
      course
        ? api<{ id: string }>(owner.api(`/courses/${course.id}`), {
            method: "PUT",
            body: { title, description, published, expectedUpdatedAt: course.updatedAt },
          })
        : api<{ id: string }>(owner.api("/courses"), { body: { title, description, published } }),
    onSuccess: (row) => {
      void client.invalidateQueries({ queryKey: owner.key("courses") })
      if (!course) router.push(owner.page(`/courses/${row.id}`))
      onDone()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{course ? "Course details" : "New course"}</DialogTitle>
          <DialogDescription>
            Add modules after creating it. Only ready courses can be given to classes.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name">
          <TextInput aria-label="Course name" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Check checked={published} onCheckedChange={setPublished} label="Ready for classes" />
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || save.isPending} onClick={() => save.mutate()}>
            {course ? "Save" : "Create course"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

let nextKey = 0
const keyed = (m: Omit<Module, "key">): Module => ({ ...m, key: m.id ?? `new-${nextKey++}` })

export function CourseEditor({ id }: { id: string }) {
  const owner = useOwner()
  const client = useQueryClient()
  const router = useRouter()
  const platform = owner.orgSlug === null
  const { data: viewer } = useViewer()
  const canShare = platform && (viewer?.user?.platform.permissions ?? []).includes("platform.library.share")
  const { data: course, error } = useQuery({
    queryKey: owner.key("course", id),
    queryFn: () => api<Course>(owner.api(`/courses/${id}`)),
  })
  const [draft, setDraft] = useState<Module[] | null>(null)
  const [editing, setEditing] = useState<number | "new" | null>(null)
  const [dialog, setDialog] = useState<"details" | "share" | null>(null)
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null)
  const modules = useMemo(() => draft ?? course?.modules.map(keyed) ?? [], [draft, course])
  const refresh = () => {
    void client.invalidateQueries({ queryKey: owner.key("course", id) })
    void client.invalidateQueries({ queryKey: owner.key("courses") })
  }
  const save = useMutation({
    mutationFn: () =>
      api<Course>(owner.api(`/courses/${id}/outline`), {
        method: "PUT",
        body: {
          expectedUpdatedAt: course!.updatedAt,
          modules: modules.map((m) => ({
            id: m.id,
            title: m.title,
            summary: m.summary,
            openAfterDays: m.openAfterDays,
            afterPrevious: m.afterPrevious,
            items: m.items.map(({ kind, id }) => ({ kind, id })),
          })),
        },
      }),
    onSuccess: (saved) => {
      client.setQueryData(owner.key("course", id), saved)
      setDraft(null)
      setMessage({ text: "Outline saved.", kind: "ok" })
      void client.invalidateQueries({ queryKey: owner.key("courses") })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const remove = useMutation({
    mutationFn: () => api(owner.api(`/courses/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: owner.key("courses") })
      router.push(owner.page("/courses"))
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const copy = useMutation({
    mutationFn: () => api<{ id: string }>(owner.api(`/courses/${id}/copy`), { body: {} }),
    onSuccess: (row) => {
      void client.invalidateQueries({ queryKey: owner.key("courses") })
      router.push(owner.page(`/courses/${row.id}`))
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })

  if (!course) return <Loading error={error} />
  const change = (next: Module[]) => {
    setDraft(next)
    setMessage(null)
  }
  const move = (index: number, by: number) => {
    const next = [...modules]
    const [m] = next.splice(index, 1)
    next.splice(index + by, 0, m!)
    change(next)
  }
  const unsaved = draft !== null

  return (
    <>
      <nav className="mb-1 text-caption">
        <Link href={owner.page("/courses")} className="hover:text-ink">
          Courses
        </Link>
      </nav>
      <PageTitle
        action={
          course.editable ? (
            <span className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog("details")}>
                Details
              </Button>
              {canShare && (
                <Button variant="outline" size="sm" onClick={() => setDialog("share")}>
                  Share…
                </Button>
              )}
              <ConfirmButton
                variant="destructive"
                size="sm"
                title={`Delete ${course.title}?`}
                description="The course and its outline go. The problems and questions stay in the library."
                confirmLabel="Delete course"
                onConfirm={() => remove.mutate()}
              >
                Delete
              </ConfirmButton>
            </span>
          ) : (
            !platform && (
              <Button size="sm" disabled={copy.isPending} onClick={() => copy.mutate()}>
                Copy to change it
              </Button>
            )
          )
        }
      >
        {course.title}
      </PageTitle>
      <p className="mb-1 max-w-3xl text-body-sm text-body">
        {course.description || "No description."}
      </p>
      <p className="mb-3 text-caption">
        {course.published ? "Ready for classes" : "Draft: not offered to classes yet"}
        {platform && ` · ${SHARING_LABEL[course.sharing]}`}
        {!course.editable && " · Shared with you: give it to classes as it is, or copy it to change it."}
      </p>
      {message && <FormMessage message={message} />}

      <ol className="grid gap-1.5" data-testid="course-modules">
        {modules.map((m, index) => (
          <li
            key={m.key}
            data-testid="course-module"
            className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2"
          >
            <span className="w-6 text-caption tabular-nums">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{m.title}</span>
              <span className="block truncate text-caption">
                {m.items.filter((i) => i.kind === "problem").length} problems ·{" "}
                {m.items.filter((i) => i.kind === "question").length} questions · {releaseLabel(m)}
              </span>
            </span>
            {course.editable ? (
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${m.title} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${m.title} down`}
                  disabled={index === modules.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button size="sm" variant="outline" aria-label={`Edit ${m.title}`} onClick={() => setEditing(index)}>
                  Edit
                </Button>
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  title={`Remove ${m.title}?`}
                  description="Its items stay in the library. Nothing changes until you save the outline."
                  confirmLabel="Remove module"
                  onConfirm={() => change(modules.filter((_, i) => i !== index))}
                >
                  Remove
                </ConfirmButton>
              </span>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing(index)}>
                View
              </Button>
            )}
          </li>
        ))}
      </ol>
      {modules.length === 0 && <p className="text-body-sm text-body">No modules yet.</p>}
      {course.editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setEditing("new")}>
            Add module
          </Button>
          <Button disabled={!unsaved || save.isPending} onClick={() => save.mutate()}>
            Save outline
          </Button>
          {unsaved && (
            <>
              <span className="text-caption text-primary">Unsaved changes</span>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Undo all
              </Button>
            </>
          )}
        </div>
      )}

      {editing !== null && (
        <ModuleDialog
          module={editing === "new" ? null : modules[editing]!}
          readOnly={!course.editable}
          onCancel={() => setEditing(null)}
          onSave={(m) => {
            change(editing === "new" ? [...modules, m] : modules.map((x, i) => (i === editing ? m : x)))
            setEditing(null)
          }}
        />
      )}
      {dialog === "details" && (
        <DetailsDialog
          course={course}
          onDone={() => {
            setDialog(null)
            refresh()
          }}
        />
      )}
      {dialog === "share" && (
        <ShareDialog
          items={[{ kind: "course", id: course.id, title: course.title }]}
          onDone={() => {
            setDialog(null)
            refresh()
          }}
        />
      )}
    </>
  )
}

interface LibraryData {
  problems: { id: string; title: string; level: string; published: boolean; listed: boolean; tags: string[] }[]
  questions: { id: string; title: string; kind: string; published: boolean; marksItself: boolean; tags: string[] }[]
}

/** One module: its name, when it opens, and its problems and questions in order. */
function ModuleDialog({
  module,
  readOnly,
  onCancel,
  onSave,
}: {
  module: Module | null
  readOnly: boolean
  onCancel: () => void
  onSave: (m: Module) => void
}) {
  const owner = useOwner()
  const [title, setTitle] = useState(module?.title ?? "")
  const [summary, setSummary] = useState(module?.summary ?? "")
  const [days, setDays] = useState(module?.openAfterDays ? String(module.openAfterDays) : "")
  const [afterPrevious, setAfterPrevious] = useState(module?.afterPrevious ?? false)
  const [items, setItems] = useState<Item[]>(module?.items ?? [])
  const [search, setSearch] = useState("")
  const { data: library } = useQuery({
    queryKey: owner.key("library"),
    queryFn: () => api<LibraryData>(owner.api("/library")),
    enabled: !readOnly,
  })
  const chosen = new Set(items.map((i) => `${i.kind}:${i.id}`))
  // Only what a course can hold: ready library problems, and questions that mark themselves.
  const candidates = useMemo(() => {
    if (!library) return []
    const q = search.trim().toLowerCase()
    const all: Item[] = [
      ...library.problems
        .filter((p) => p.published && p.listed)
        .map((p) => ({ kind: "problem" as const, id: p.id, title: p.title, detail: p.level, tags: p.tags })),
      ...library.questions
        .filter((x) => x.published && x.marksItself)
        .map((x) => ({ kind: "question" as const, id: x.id, title: x.title, detail: x.kind, tags: x.tags })),
    ].filter(
      (i) =>
        !chosen.has(`${i.kind}:${i.id}`) &&
        (!q || i.title.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q)))
    )
    return all.slice(0, 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, search, items])
  const move = (index: number, by: number) => {
    const next = [...items]
    const [it] = next.splice(index, 1)
    next.splice(index + by, 0, it!)
    setItems(next)
  }
  const daysValue = days.trim() === "" ? null : Number(days)
  const daysOk = daysValue === null || (Number.isInteger(daysValue) && daysValue >= 0 && daysValue <= 730)

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" data-testid="module-dialog">
        <DialogHeader>
          <DialogTitle>{module ? module.title : "New module"}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? releaseLabel({ openAfterDays: module?.openAfterDays ?? null, afterPrevious: module?.afterPrevious ?? false })
              : "Students see a module once it opens. Changes apply when you save the outline."}
          </DialogDescription>
        </DialogHeader>
        {!readOnly && (
          <>
            <Field label="Name">
              <TextInput aria-label="Module name" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Summary (optional)">
              <TextArea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Opens after (days from the class's start)" help="Empty: at the start.">
                <TextInput
                  aria-label="Opens after days"
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </Field>
              <div className="self-end pb-2">
                <Check
                  checked={afterPrevious}
                  onCheckedChange={setAfterPrevious}
                  label="Only after finishing the module before"
                />
              </div>
            </div>
          </>
        )}
        {module?.summary && readOnly && <p className="text-body-sm">{module.summary}</p>}
        <div className="grid gap-1">
          <div className="text-caption font-medium text-ink">In this module, in order</div>
          <ol className="grid gap-0.5 rounded-md border border-hairline p-1" data-testid="module-items">
            {items.map((item, index) => (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-muted"
              >
                <span className="w-6 text-caption tabular-nums">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{item.title}</span>
                <span className="text-xs text-body capitalize">{itemDetail(item)}</span>
                {!readOnly && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${item.title} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${item.title} down`}
                      disabled={index === items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${item.title}`}
                      onClick={() => setItems(items.filter((_, i) => i !== index))}
                    >
                      ✕
                    </Button>
                  </>
                )}
              </li>
            ))}
            {items.length === 0 && <li className="px-1.5 py-1 text-caption">Nothing yet.</li>}
          </ol>
        </div>
        {!readOnly && (
          <div className="grid gap-1">
            <div className="text-caption font-medium text-ink">Add from the library</div>
            <TextInput
              aria-label="Search problems and questions"
              placeholder="Search titles and tags"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul className="grid max-h-56 gap-0.5 overflow-y-auto rounded-md border border-hairline p-1" data-testid="module-candidates">
              {!library && <li className="px-1.5 py-1 text-caption">Loading…</li>}
              {candidates.map((item) => (
                <li key={`${item.kind}:${item.id}`} className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{item.title}</span>
                  <span className="text-xs text-body capitalize">{itemDetail(item)}</span>
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label={`Add ${item.title}`}
                    onClick={() => setItems([...items, item])}
                  >
                    Add
                  </Button>
                </li>
              ))}
              {library && candidates.length === 0 && <li className="px-1.5 py-1 text-caption">Nothing matches.</li>}
            </ul>
            <p className="text-caption">
              Courses hold ready library problems and questions that mark themselves (choice, and
              short answers with accepted answers): practice nobody has to mark.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button
              disabled={!title.trim() || !daysOk}
              onClick={() =>
                onSave({
                  id: module?.id,
                  key: module?.key ?? `new-${nextKey++}`,
                  title: title.trim(),
                  summary,
                  openAfterDays: daysValue || null,
                  afterPrevious,
                  items,
                })
              }
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
