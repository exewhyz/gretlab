"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useMemo, useState } from "react"

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
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextArea, TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { Loading, PageTitle, Table } from "@/features/admin/components/shell"
import { useOwner } from "@/features/admin/owner"
import { KIND_LABEL } from "@/features/questions/components/question-editor"
import { api } from "@/lib/api/client"

type Kind = "problem" | "question"
type Source = "ours" | "platform" | "shared"
type Sharing = "everyone" | "selected" | "owner"

interface Base {
  id: string
  title: string
  published: boolean
  sharing: Sharing
  orgId: string | null
  source: Source
  owner: string
  collections: string[]
  sharedWith: number
  copiedFrom: string | null
}
interface LibraryProblem extends Base {
  kind: "problem"
  slug: string
  level: string
  listed: boolean
  tags: string[]
}
interface LibraryQuestion extends Base {
  kind: "single" | "multiple" | "short" | "written"
  points: number
  tags: string[]
  marksItself: boolean
}
interface Library {
  collections: { id: string; name: string; description: string; size: number }[]
  problems: LibraryProblem[]
  questions: LibraryQuestion[]
}

const SOURCE_LABEL: Record<Source, string> = {
  ours: "Ours",
  platform: "Platform",
  shared: "Shared with us",
}
const SHARING_LABEL: Record<Sharing, string> = {
  everyone: "Every college",
  selected: "Chosen",
  owner: "Staff only",
}
const PAGE = 100

/**
 * The library: everything this owner has, and what's shared with it, in one place, with
 * collections, search and filters. The platform shares from here; colleges copy from here.
 */
export function LibraryPage() {
  const owner = useOwner()
  const client = useQueryClient()
  const { data: viewer } = useViewer()
  const platform = owner.orgSlug === null
  const canShare =
    platform && (viewer?.user?.platform.permissions ?? []).includes("platform.library.share")
  const { data, error } = useQuery({
    queryKey: owner.key("library"),
    queryFn: () => api<Library>(owner.api("/library")),
  })
  const [tab, setTab] = useState<Kind>("problem")
  const [collection, setCollection] = useState<string>("")
  const [search, setSearch] = useState("")
  const [source, setSource] = useState("")
  const [detail, setDetail] = useState("")
  const [status, setStatus] = useState("")
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<
    null | { type: "collection"; id: string | null } | { type: "share" }
  >(null)
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: owner.key("library") })

  const rows: (LibraryProblem | LibraryQuestion)[] = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    const all: (LibraryProblem | LibraryQuestion)[] =
      tab === "problem" ? data.problems : data.questions
    return all.filter(
      (r) =>
        (!collection || r.collections.includes(collection)) &&
        (!source || r.source === source) &&
        (!status || (status === "published") === r.published) &&
        (!detail || (r.kind === "problem" ? (r as LibraryProblem).level : r.kind) === detail) &&
        (!q ||
          r.title.toLowerCase().includes(q) ||
          r.tags.some((t) => t.toLowerCase().includes(q)) ||
          r.owner.toLowerCase().includes(q))
    )
  }, [data, tab, collection, search, source, detail, status])

  const kindOf = (): Kind => tab
  const selected = rows.filter((r) => picked.has(r.id))
  const refs = selected.map((r) => ({ kind: kindOf(), id: r.id }))
  const change = useMutation({
    mutationFn: (body: { id: string; add?: typeof refs; remove?: typeof refs }) =>
      api(owner.api(`/collections/${body.id}`), {
        method: "PATCH",
        body: { add: body.add ?? [], remove: body.remove ?? [] },
      }),
    onSuccess: () => {
      setPicked(new Set())
      setMessage({ text: "Collection updated.", kind: "ok" })
      void refresh()
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const copy = useMutation({
    mutationFn: () =>
      api<{ created: { title: string }[] }>(owner.api("/library/copy"), { body: { items: refs } }),
    onSuccess: (r) => {
      setPicked(new Set())
      setMessage({
        text: `Copied ${r.created.length} into your library. Copies of problems start as drafts.`,
        kind: "ok",
      })
      void refresh()
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })

  if (!data) return <Loading error={error} />
  const count = (kind: Kind) => (kind === "problem" ? data.problems.length : data.questions.length)
  const current = data.collections.find((c) => c.id === collection)
  const editHref = (r: LibraryProblem | LibraryQuestion) =>
    r.source === "ours"
      ? owner.page(`/${r.kind === "problem" ? "problems" : "questions"}/${r.id}`)
      : null
  const notOurs = selected.filter((r) => r.source !== "ours").length
  const ours = selected.filter((r) => r.source === "ours").length

  return (
    <>
      <PageTitle
        action={
          <span className="flex gap-2">
            <Link
              href={owner.page("/questions/new")}
              className="text-caption underline-offset-2 hover:underline"
            >
              New question
            </Link>
            <Link
              href={owner.page("/problems/new")}
              className="text-caption underline-offset-2 hover:underline"
            >
              New problem
            </Link>
          </span>
        }
      >
        Library
      </PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        {platform
          ? "Everything the platform has: share it with every college, chosen colleges or teachers, or keep it to staff. Group it into collections."
          : "Your college's content and what the platform shares with you, in one place. Copy shared items to adapt them; group anything into collections."}
      </p>
      <div className="grid gap-4 min-[1101px]:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="grid content-start gap-1" data-testid="collections">
          <div className="flex items-center justify-between px-2 text-caption font-semibold text-ink">
            Collections
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setDialog({ type: "collection", id: null })}
            >
              + New
            </Button>
          </div>
          {[{ id: "", name: "Everything", size: count(tab) }, ...data.collections].map((c) => (
            <Button
              key={c.id || "all"}
              variant="ghost"
              className={cn(
                "h-auto justify-between px-2 py-1.5 text-body-sm font-normal",
                collection === c.id && "bg-muted text-ink"
              )}
              onClick={() => {
                setCollection(c.id)
                setPicked(new Set())
              }}
            >
              <span className="truncate">{c.name}</span>
              <span className="text-xs text-body tabular-nums">{c.size}</span>
            </Button>
          ))}
          {current && (
            <Button
              variant="link"
              size="xs"
              className="justify-self-start px-2"
              onClick={() => setDialog({ type: "collection", id: current.id })}
            >
              Rename or delete
            </Button>
          )}
        </aside>
        <div className="grid min-w-0 content-start gap-3">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as Kind)
              setDetail("")
              setPicked(new Set())
              setShown(PAGE)
            }}
          >
            <TabsList variant="line">
              <TabsTrigger value="problem">Problems ({data.problems.length})</TabsTrigger>
              <TabsTrigger value="question">Questions ({data.questions.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap gap-2" data-testid="library-filters">
            <TextInput
              aria-label="Search the library"
              placeholder="Search titles, tags, owners"
              className="w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <SelectInput aria-label="Source" className="w-40" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Any source</option>
              <option value="ours">Ours</option>
              {!platform && <option value="platform">Platform</option>}
              <option value="shared">{platform ? "From colleges" : "Shared with us"}</option>
            </SelectInput>
            <SelectInput
              aria-label={tab === "problem" ? "Difficulty" : "Type"}
              className="w-40"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            >
              <option value="">{tab === "problem" ? "Any difficulty" : "Any type"}</option>
              {tab === "problem"
                ? ["easy", "medium", "hard"].map((l) => (
                    <option key={l} value={l} className="capitalize">
                      {l[0]!.toUpperCase() + l.slice(1)}
                    </option>
                  ))
                : Object.entries(KIND_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
            </SelectInput>
            <SelectInput aria-label="Status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="published">Ready</option>
              <option value="draft">Draft</option>
            </SelectInput>
          </div>
          {picked.size > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-card p-2 text-body-sm"
              data-testid="library-bulk"
            >
              <span className="text-ink">{picked.size} selected</span>
              {data.collections.length > 0 && (
                <SelectInput
                  aria-label="Add to collection"
                  className="w-48 py-1"
                  value=""
                  onChange={(e) => e.target.value && change.mutate({ id: e.target.value, add: refs })}
                >
                  <option value="">Add to collection…</option>
                  {data.collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectInput>
              )}
              {current && (
                <Button size="sm" variant="outline" onClick={() => change.mutate({ id: current.id, remove: refs })}>
                  Remove from {current.name}
                </Button>
              )}
              {canShare && ours > 0 && (
                <Button size="sm" variant="outline" onClick={() => setDialog({ type: "share" })}>
                  Share…
                </Button>
              )}
              {!platform && notOurs > 0 && (
                <Button size="sm" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate()}>
                  Copy to our library
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </div>
          )}
          {message && <FormMessage message={message} />}
          <Table
            headers={[
              "",
              "Title",
              tab === "problem" ? "Difficulty" : "Type",
              "Tags",
              "Source",
              ...(platform ? ["Shared with"] : []),
              "Status",
            ]}
          >
            {rows.slice(0, shown).map((r) => {
              const href = editHref(r)
              return (
                <tr key={r.id} data-testid="library-row">
                  <td className="w-8">
                    <Checkbox
                      aria-label={`Select ${r.title}`}
                      checked={picked.has(r.id)}
                      onCheckedChange={(checked) =>
                        setPicked((all) => {
                          const next = new Set(all)
                          if (checked) next.add(r.id)
                          else next.delete(r.id)
                          return next
                        })
                      }
                    />
                  </td>
                  <td>
                    {href ? (
                      <Link href={href} className="font-medium text-ink underline-offset-2 hover:underline">
                        {r.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{r.title}</span>
                    )}
                    {r.copiedFrom && <span className="ml-1 text-xs text-body">(copy)</span>}
                  </td>
                  <td className="capitalize">
                    {r.kind === "problem" ? (r as LibraryProblem).level : KIND_LABEL[r.kind]}
                  </td>
                  <td className="max-w-48 truncate text-caption">{r.tags.join(", ")}</td>
                  <td className="text-caption">
                    {r.source === "ours" ? "Ours" : r.owner}
                  </td>
                  {platform && (
                    <td className="text-caption" data-testid="sharing-cell">
                      {r.source === "ours"
                        ? r.sharing === "selected"
                          ? `${r.sharedWith} chosen`
                          : SHARING_LABEL[r.sharing]
                        : "—"}
                    </td>
                  )}
                  <td className="text-caption">{r.published ? "Ready" : "Draft"}</td>
                </tr>
              )
            })}
          </Table>
          {rows.length === 0 && <p className="text-body-sm text-body">Nothing matches.</p>}
          {rows.length > shown && (
            <Button variant="outline" className="justify-self-start" onClick={() => setShown(shown + PAGE)}>
              Show more ({rows.length - shown} left)
            </Button>
          )}
        </div>
      </div>
      {dialog?.type === "collection" && (
        <CollectionDialog
          collection={dialog.id ? (data.collections.find((c) => c.id === dialog.id) ?? null) : null}
          onDone={(deleted) => {
            if (deleted) setCollection("")
            setDialog(null)
            void refresh()
          }}
        />
      )}
      {dialog?.type === "share" && (
        <ShareDialog
          items={selected.filter((r) => r.source === "ours").map((r) => ({ kind: kindOf(), id: r.id, title: r.title }))}
          onDone={() => {
            setDialog(null)
            setPicked(new Set())
            void refresh()
          }}
        />
      )}
    </>
  )
}

function CollectionDialog({
  collection,
  onDone,
}: {
  collection: { id: string; name: string; description: string } | null
  onDone: (deleted?: boolean) => void
}) {
  const owner = useOwner()
  const [name, setName] = useState(collection?.name ?? "")
  const [description, setDescription] = useState(collection?.description ?? "")
  const save = useMutation({
    mutationFn: () =>
      collection
        ? api(owner.api(`/collections/${collection.id}`), { method: "PUT", body: { name, description } })
        : api(owner.api("/collections"), { body: { name, description } }),
    onSuccess: () => onDone(),
  })
  const remove = useMutation({
    mutationFn: () => api(owner.api(`/collections/${collection!.id}`), { method: "DELETE" }),
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{collection ? "Edit collection" : "New collection"}</DialogTitle>
          <DialogDescription>
            A folder for finding content again, such as &ldquo;Mid-sem 2026&rdquo; or
            &ldquo;Recursion practice&rdquo;. Items stay in the library; a collection only groups them.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name">
          <TextInput aria-label="Collection name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {(save.error || remove.error) && (
          <FormMessage message={{ text: (save.error ?? remove.error)!.message, kind: "err" }} />
        )}
        <DialogFooter>
          {collection && (
            <ConfirmButton
              variant="destructive"
              className="mr-auto"
              title={`Delete ${collection.name}?`}
              description="Only the collection goes; its items stay in the library."
              confirmLabel="Delete collection"
              onConfirm={() => remove.mutate()}
            >
              Delete
            </ConfirmButton>
          )}
          <Button variant="outline" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** How far some of the platform's items reach. */
export function ShareDialog({
  items,
  onDone,
}: {
  items: { kind: Kind | "course" | "template"; id: string; title: string }[]
  onDone: () => void
}) {
  const single = items.length === 1 ? items[0]! : null
  const { data } = useQuery({
    queryKey: ["admin", "sharing", single?.id ?? "many"],
    queryFn: () =>
      api<{ colleges: { id: string; name: string }[]; current: { orgIds: string[]; emails: string[] } | null }>(
        `/admin/library/sharing${single ? `?kind=${single.kind}&id=${single.id}` : ""}`
      ),
  })
  const [sharing, setSharing] = useState<Sharing | null>(null)
  const [orgIds, setOrgIds] = useState<string[] | null>(null)
  const [emails, setEmails] = useState<string | null>(null)
  const chosenOrgs = orgIds ?? data?.current?.orgIds ?? []
  const chosenEmails = emails ?? (data?.current?.emails ?? []).join("\n")
  const mode = sharing ?? (data?.current && (data.current.orgIds.length || data.current.emails.length) ? "selected" : "everyone")
  const save = useMutation({
    mutationFn: () =>
      api("/admin/library/sharing", {
        method: "PUT",
        body: {
          items: items.map(({ kind, id }) => ({ kind, id })),
          sharing: mode,
          orgIds: chosenOrgs,
          emails: chosenEmails
            .split(/[\s,]+/)
            .map((e) => e.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>Share {single ? single.title : `${items.length} items`}</DialogTitle>
          <DialogDescription>
            {items.every((i) => i.kind === "course")
              ? "Which colleges may give this course to their classes or copy it."
              : items.every((i) => i.kind === "template")
                ? "Which colleges may use this template for their classes, with their own dates, or copy it."
              : `Who may use ${single ? "it" : "them"} in their own assignments, exams, contests and daily challenges. Public library problems stay free to practise either way.`}
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <Loading />
        ) : (
          <>
            <RadioGroup value={mode} onValueChange={(v) => setSharing(v as Sharing)} className="gap-2">
              {(
                [
                  ["everyone", "Every college", "All colleges and their teachers."],
                  ["selected", "Chosen colleges and teachers", "Only the ones you pick below."],
                  ["owner", "Platform staff only", "Not shared with any college."],
                ] as const
              ).map(([value, label, help]) => (
                <label key={value} className="flex items-start gap-2 text-body-sm">
                  <RadioGroupItem value={value} aria-label={label} />
                  <span>
                    <span className="text-ink">{label}</span>
                    <span className="block text-caption">{help}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            {mode === "selected" && (
              <div className="grid gap-2">
                <div className="text-caption font-medium text-ink">Colleges</div>
                <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-hairline p-2">
                  {data.colleges.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-body-sm">
                      <Checkbox
                        checked={chosenOrgs.includes(c.id)}
                        onCheckedChange={(checked) =>
                          setOrgIds(
                            checked ? [...chosenOrgs, c.id] : chosenOrgs.filter((x) => x !== c.id)
                          )
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                  {data.colleges.length === 0 && <p className="text-caption">No colleges yet.</p>}
                </div>
                <Field label="Teachers (emails, one per line)" help="For teachers who aren't in a college, or one teacher in a college.">
                  <TextArea rows={3} value={chosenEmails} onChange={(e) => setEmails(e.target.value)} />
                </Field>
              </div>
            )}
          </>
        )}
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={!data || save.isPending} onClick={() => save.mutate()}>
            Save sharing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
