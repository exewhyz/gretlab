"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Empty, EmptyHeader, EmptyTitle } from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import {
  Check,
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import type { listApplications } from "@/features/admissions/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"
import { STATUS, Status, shortDate } from "./admissions-parts"

export type List = ApiResult<typeof listApplications>

export const FILTERS: { value: "" | Status; label: string }[] = [
  { value: "", label: "All" },
  { value: "submitted", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "admitted", label: "Admitted" },
  { value: "rejected", label: "Not admitted" },
  { value: "withdrawn", label: "Withdrawn" },
]

/** Manage › Admissions: open or close them, and the applications. */
export function Admissions({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"" | Status>("")
  const [gradeId, setGradeId] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const params = new URLSearchParams({
    status,
    gradeId,
    q,
    page: String(page),
  }).toString()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "admissions", params],
    queryFn: () => api<List>(`/orgs/${slug}/admissions?${params}`),
  })
  if (!data) return <Loading error={error} />
  const link =
    typeof window === "undefined"
      ? `/orgs/${slug}/apply`
      : `${window.location.origin}/orgs/${slug}/apply`
  const all = Object.values(data.counts).reduce((s, n) => s + (n ?? 0), 0)
  return (
    <>
      <PageTitle
        action={
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            Admission settings
          </Button>
        }
      >
        Admissions
      </PageTitle>
      <Card size="sm" className="mb-4" data-testid="admissions-state">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {data.settings.open ? (
              <Badge>Open</Badge>
            ) : (
              <Badge variant="outline">Closed</Badge>
            )}
            {data.settings.open
              ? `Taking applications for ${data.settings.yearName ?? "the year"}`
              : "Not taking applications"}
          </CardTitle>
          <CardDescription className="break-all">
            {data.settings.open ? (
              <>
                Parents apply at <span className="text-ink">{link}</span>;
                it&apos;s on your public page too.
              </>
            ) : (
              "Open admissions in the settings to show an Apply button on your public page."
            )}
          </CardDescription>
          {data.settings.open && (
            <CardAction>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void navigator.clipboard?.writeText(link)}
              >
                Copy link
              </Button>
            </CardAction>
          )}
        </CardHeader>
      </Card>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
          {FILTERS.map((f) => {
            const n = f.value ? (data.counts[f.value] ?? 0) : all
            return (
              <Button
                key={f.value}
                size="sm"
                variant={status === f.value ? "default" : "outline"}
                aria-pressed={status === f.value}
                onClick={() => (setStatus(f.value), setPage(1))}
              >
                {f.label}
                <span className="tabular-nums opacity-70">{n}</span>
              </Button>
            )
          })}
        </div>
        <div className="w-40">
          <Field label="Class">
            <SelectInput
              value={gradeId}
              onChange={(e) => (setGradeId(e.target.value), setPage(1))}
            >
              <option value="">All</option>
              {data.grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className="w-56">
          <Field label="Search">
            <TextInput
              value={q}
              placeholder="Name or number"
              onChange={(e) => (setQ(e.target.value), setPage(1))}
            />
          </Field>
        </div>
      </div>
      {data.applications.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>
              No applications
              {status ? ` that are ${STATUS[status].label.toLowerCase()}` : ""}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table data-testid="applications">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.applications.map((a) => (
                <TableRow key={a.id} data-testid="application-row">
                  <TableCell>
                    <Link
                      href={orgPages(slug).manage(`/admissions/${a.id}`)}
                      className="font-medium hover:underline"
                    >
                      {a.studentName}
                    </Link>
                    <div className="text-caption text-muted-foreground">
                      {a.number}
                    </div>
                  </TableCell>
                  <TableCell>{a.grade ?? "–"}</TableCell>
                  <TableCell>
                    {a.parentName}
                    <div className="text-caption text-muted-foreground">
                      {a.email}
                    </div>
                  </TableCell>
                  <TableCell>{shortDate(a.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS[a.status].variant}>
                      {STATUS[a.status].label}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {data.total > 50 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-body-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {Math.ceil(data.total / 50)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page * 50 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog slug={slug} onDone={() => setSettingsOpen(false)} />
      )}
    </>
  )
}

export function SettingsDialog({
  slug,
  onDone,
}: {
  slug: string
  onDone: () => void
}) {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "admission-settings"],
    queryFn: () =>
      api<{
        settings: {
          open: boolean
          yearId: string | null
          gradeIds: string[]
          instructions: string
        }
        years: { id: string; name: string; isCurrent: boolean }[]
        grades: { id: string; name: string }[]
      }>(`/orgs/${slug}/admissions/settings`),
  })
  const [form, setForm] = useState<{
    open: boolean
    yearId: string | null
    gradeIds: string[]
    instructions: string
  } | null>(null)
  useEffect(() => {
    if (data && !form) setForm(data.settings)
  }, [data, form])
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/admissions/settings`, { method: "PUT", body: form }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug] })
      onDone()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Admission settings</DialogTitle>
          <DialogDescription>
            Who can apply, for when, and what they should know.
          </DialogDescription>
        </DialogHeader>
        {!data || !form ? (
          <Loading error={error} />
        ) : (
          <div className="grid gap-3">
            <Check
              label="Taking applications"
              checked={form.open}
              onCheckedChange={(v) => setForm({ ...form, open: v })}
            />
            <Field label="For the academic year">
              <SelectInput
                value={form.yearId ?? ""}
                onChange={(e) =>
                  setForm({ ...form, yearId: e.target.value || null })
                }
              >
                <option value="">Choose a year</option>
                {data.years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                    {y.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {data.years.length === 0 && (
              <p className="text-caption text-destructive">
                Add an academic year first, in{" "}
                <Link
                  className="underline"
                  href={orgPages(slug).manage(`/academic-years`)}
                >
                  Academic years
                </Link>
                .
              </p>
            )}
            <div className="grid gap-1">
              <span className="text-caption font-semibold text-ink">
                Classes taking applications
              </span>
              <span className="text-caption text-muted-foreground">
                None ticked: all of them.
              </span>
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-hairline p-2">
                {data.grades.map((g) => (
                  <Check
                    key={g.id}
                    label={g.name}
                    checked={form.gradeIds.includes(g.id)}
                    onCheckedChange={(v) =>
                      setForm({
                        ...form,
                        gradeIds: v
                          ? [...form.gradeIds, g.id]
                          : form.gradeIds.filter((x) => x !== g.id),
                      })
                    }
                  />
                ))}
              </div>
            </div>
            <Field label="Instructions for parents">
              <TextArea
                maxLength={2000}
                value={form.instructions}
                placeholder="Documents to bring, test dates, fees…"
                onChange={(e) =>
                  setForm({ ...form, instructions: e.target.value })
                }
              />
            </Field>
          </div>
        )}
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={!form || save.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
