"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { SelectInput, TextInput } from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDate } from "@/lib/format"

interface Entry {
  id: string
  action: string
  category: string
  categoryLabel: string
  summary: string
  detail: Record<string, unknown> | null
  actor: {
    id: string | null
    name: string
    email: string | null
    removed: boolean
  }
  ip: string | null
  device: string | null
  support: boolean
  createdAt: string
}

interface Page {
  entries: Entry[]
  next: string | null
  filters: {
    categories: { key: string; label: string }[]
    people: { id: string; name: string; email: string }[]
  }
}

interface Filters {
  q: string
  category: string
  actor: string
  from: string
  to: string
}

const EMPTY: Filters = { q: "", category: "", actor: "", from: "", to: "" }

const time = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })

/**
 * An activity log, for an organization (Manage › Activity) or the platform (Dashboard ›
 * Activity): filters, entries by day, details in a dialog, more on request, and CSV.
 */
export function AuditLog({
  base,
  title = "Activity",
}: {
  base: string
  title?: string
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  // Typing waits a moment before searching.
  const [q, setQ] = useState("")
  useEffect(() => {
    const t = setTimeout(
      () => setFilters((f) => (f.q === q ? f : { ...f, q })),
      300
    )
    return () => clearTimeout(t)
  }, [q])
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][]
  )
  const log = useInfiniteQuery({
    queryKey: ["audit", base, params.toString()],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params)
      if (pageParam) p.set("before", pageParam)
      return api<Page>(`${base}?${p}`)
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
  })
  const [open, setOpen] = useState<Entry | null>(null)
  const first = log.data?.pages[0]
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? []
  const set = (key: keyof Filters) => (e: { target: { value: string } }) =>
    setFilters({ ...filters, [key]: e.target.value })
  const filtered = Object.entries(filters).some(([, v]) => v)
  const days = new Map<string, Entry[]>()
  for (const e of entries) {
    const day = formatDate(e.createdAt)
    days.set(day, [...(days.get(day) ?? []), e])
  }
  return (
    <>
      <PageTitle
        action={
          <a
            href={`/api/v1${base}/export?${params}`}
            download
            className={buttonVariants({ variant: "outline" })}
          >
            Download CSV
          </a>
        }
      >
        {title}
      </PageTitle>
      <div
        className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_auto_auto_auto]"
        data-testid="audit-filters"
      >
        <TextInput
          aria-label="Search the activity log"
          placeholder="Search what changed or who"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectInput
          aria-label="Area"
          value={filters.category}
          onChange={set("category")}
        >
          <option value="">Every area</option>
          {first?.filters.categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Person"
          value={filters.actor}
          onChange={set("actor")}
        >
          <option value="">Everyone</option>
          {first?.filters.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectInput>
        <TextInput
          aria-label="From"
          type="date"
          value={filters.from}
          onChange={set("from")}
        />
        <TextInput
          aria-label="To"
          type="date"
          value={filters.to}
          onChange={set("to")}
        />
        <Button
          variant="ghost"
          disabled={!filtered && !q}
          onClick={() => {
            setQ("")
            setFilters(EMPTY)
          }}
        >
          Clear
        </Button>
      </div>
      {!log.data ? (
        <Loading error={log.error} />
      ) : entries.length === 0 ? (
        <p className="text-body-sm text-body">
          {filtered ? "Nothing matches these filters." : "Nothing yet."}
        </p>
      ) : (
        <div className="grid gap-5" data-testid="audit-log">
          {[...days.entries()].map(([day, list]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-1.5 text-caption-upper text-body uppercase">
                {day}
              </h2>
              <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-card">
                {list.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      data-testid="audit-entry"
                      onClick={() => setOpen(e)}
                      className="grid w-full gap-x-4 gap-y-0.5 px-4 py-2.5 text-left text-body-sm hover:bg-muted/40 sm:grid-cols-[4rem_1fr_auto]"
                    >
                      <span className="text-xs text-body tabular-nums sm:pt-0.5">
                        {time(e.createdAt)}
                      </span>
                      <span className="min-w-0">
                        <span className="text-ink">{e.summary}</span>
                        <span className="block truncate text-xs text-body">
                          {e.actor.name}
                          {e.actor.removed && " (account removed)"}
                          {e.device && ` · ${e.device}`}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-start gap-1 sm:justify-end">
                        {e.support && (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                            Support
                          </span>
                        )}
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                          {e.categoryLabel}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {log.hasNextPage && (
            <Button
              variant="outline"
              className="justify-self-center"
              disabled={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              {log.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
      )}
      {open && (
        <EntryDialog
          entry={open}
          onClose={() => setOpen(null)}
          onPerson={(actor) => {
            setFilters({ ...filters, actor })
            setOpen(null)
          }}
        />
      )}
    </>
  )
}

interface Change {
  field: string
  from: string
  to: string
}

interface ListChange {
  label: string
  added: string[]
  removed: string[]
}

function EntryDialog({
  entry,
  onClose,
  onPerson,
}: {
  entry: Entry
  onClose: () => void
  onPerson: (actorId: string) => void
}) {
  const detail = entry.detail ?? {}
  const changes = Array.isArray(detail.changes)
    ? (detail.changes as Change[])
    : []
  const lists = Array.isArray(detail.lists)
    ? (detail.lists as ListChange[])
    : []
  // Older entries kept bare added/removed lists.
  if (
    !lists.length &&
    (Array.isArray(detail.added) || Array.isArray(detail.removed))
  ) {
    lists.push({
      label: "Items",
      added: (detail.added as string[] | undefined) ?? [],
      removed: (detail.removed as string[] | undefined) ?? [],
    })
  }
  const rest = Object.entries(detail).filter(
    ([k, v]) =>
      !["changes", "lists", "added", "removed"].includes(k) &&
      v !== null &&
      v !== ""
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{entry.summary}</DialogTitle>
          <DialogDescription>
            {entry.categoryLabel} · {new Date(entry.createdAt).toLocaleString()}
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid max-h-[65dvh] gap-4 overflow-y-auto text-body-sm"
          data-testid="audit-detail"
        >
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-body">Who</dt>
            <dd className="min-w-0 text-ink">
              {entry.actor.name}
              {entry.actor.email && entry.actor.email !== entry.actor.name && (
                <span className="text-body"> · {entry.actor.email}</span>
              )}
              {entry.actor.removed && (
                <span className="text-body"> (account removed)</span>
              )}
              {entry.actor.id && !entry.actor.removed && (
                <button
                  type="button"
                  className="ml-2 text-caption text-body underline hover:text-ink"
                  onClick={() => onPerson(entry.actor.id!)}
                >
                  Everything they did
                </button>
              )}
            </dd>
            {entry.support && (
              <>
                <dt className="text-body">As</dt>
                <dd className="text-destructive">
                  Platform support, not a member
                </dd>
              </>
            )}
            <dt className="text-body">From</dt>
            <dd className="text-ink">
              {[entry.device, entry.ip].filter(Boolean).join(" · ") ||
                "Not recorded"}
            </dd>
            <dt className="text-body">Action</dt>
            <dd className="font-mono text-xs text-ink">{entry.action}</dd>
          </dl>
          {changes.length > 0 && (
            <table className="w-full text-left" data-testid="audit-changes">
              <thead className="text-caption text-body">
                <tr>
                  <th className="py-1 pr-3 font-normal">Changed</th>
                  <th className="py-1 pr-3 font-normal">From</th>
                  <th className="py-1 font-normal">To</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr
                    key={c.field}
                    className="border-t border-hairline align-top"
                  >
                    <td className="py-1.5 pr-3 text-body">{c.field}</td>
                    <td className="py-1.5 pr-3 text-body line-through decoration-body/40">
                      {c.from}
                    </td>
                    <td className="py-1.5 text-ink">{c.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lists.map((l) => (
            <div key={l.label} className="grid gap-1">
              <div className="text-caption font-semibold text-ink">
                {l.label}
              </div>
              {l.added.length > 0 && (
                <p className="text-ink">
                  <span className="text-success">Added:</span>{" "}
                  {l.added.join(", ")}
                </p>
              )}
              {l.removed.length > 0 && (
                <p className="text-ink">
                  <span className="text-destructive">Removed:</span>{" "}
                  {l.removed.join(", ")}
                </p>
              )}
            </div>
          ))}
          {rest.length > 0 && (
            <dl
              className={cn(
                "grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 border-t border-hairline pt-3"
              )}
            >
              {rest.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-body">{k}</dt>
                  <dd className="min-w-0 break-words text-ink">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
