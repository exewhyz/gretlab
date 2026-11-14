"use client"

import { DotsThreeIcon, PlusIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { ConfirmDialog } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { listYears } from "@/features/records/server"

import { Year, longDate } from "./records-parts"

/** Manage › Academic years. */
export function AcademicYears({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "academic-years"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<ApiResult<typeof listYears>>(`/orgs/${slug}/academic-years`),
  })
  const [editing, setEditing] = useState<Year | "new" | null>(null)
  const [current, setCurrent] = useState<Year | null>(null)
  const [removing, setRemoving] = useState<Year | null>(null)
  const [leads, setLeads] = useState<Year | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ["org", slug] })
  const act = useMutation({
    mutationFn: (v: { year: Year; kind: "current" | "delete" }) =>
      v.kind === "current"
        ? api(`/orgs/${slug}/academic-years/${v.year.id}`, {
            method: "PATCH",
            body: { isCurrent: true },
          })
        : api(`/orgs/${slug}/academic-years/${v.year.id}`, {
            method: "DELETE",
          }),
    onSuccess: () => void refresh(),
  })
  if (!data) return <Loading error={error} />
  const can = data.can.years
  return (
    <>
      <PageTitle
        action={
          can && (
            <div className="flex flex-wrap gap-2">
              {data.years.length > 1 && (
                <Link
                  href={orgPages(slug).manage(`/academic-years/promote`)}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Promote students
                </Link>
              )}
              <Button onClick={() => setEditing("new")}>
                <PlusIcon /> Add academic year
              </Button>
            </div>
          )
        }
      >
        {data.terms?.periods ?? "Academic years"}
      </PageTitle>
      <p className="mb-4 max-w-2xl text-body-sm text-muted-foreground">
        Each student has a class for each year. The current year&apos;s classes
        are where students sit now: registers, timetables and parents follow
        them. Making another year current moves everyone to their class in it.
      </p>
      {act.error && (
        <FormMessage message={{ text: act.error.message, kind: "err" }} />
      )}
      {data.years.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No academic years yet</EmptyTitle>
            <EmptyDescription>
              Add this year, like 2026-2027, and make it current.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table data-testid="years">
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead className="hidden sm:table-cell">Ends</TableHead>
                <TableHead className="text-right">Students</TableHead>
                {can && (
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.years.map((y) => (
                <TableRow key={y.id} data-testid="year-row">
                  <TableCell className="font-medium">
                    {y.name}{" "}
                    {y.isCurrent && <Badge className="ml-1">Current</Badge>}
                  </TableCell>
                  <TableCell>{longDate(y.startsOn)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {longDate(y.endsOn)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {y.enrolled}
                  </TableCell>
                  {can && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${y.name}`}
                            />
                          }
                        >
                          <DotsThreeIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(y)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLeads(y)}>
                            Class teachers
                          </DropdownMenuItem>
                          {!y.isCurrent && (
                            <DropdownMenuItem onClick={() => setCurrent(y)}>
                              Make current
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setRemoving(y)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {editing && (
        <YearDialog
          slug={slug}
          year={editing === "new" ? null : editing}
          onDone={(changed) => (setEditing(null), changed && void refresh())}
        />
      )}
      {leads && (
        <ClassTeachersDialog
          slug={slug}
          year={leads}
          onDone={() => setLeads(null)}
        />
      )}
      {current && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setCurrent(null)}
          title={`Make ${current.name} the current year?`}
          description={`Every student moves to their class in ${current.name}; students with no class in it are left without one. Their classes in other years are kept.`}
          confirmLabel="Make current"
          tone="default"
          onConfirm={() => act.mutate({ year: current, kind: "current" })}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={`Delete ${removing.name}?`}
          description="Only a year with no students in it can be deleted."
          confirmLabel="Delete"
          onConfirm={() => act.mutate({ year: removing, kind: "delete" })}
        />
      )}
    </>
  )
}

export interface LeadSection {
  groupId: string
  name: string
  teacherId: string | null
  options: { id: string; name: string }[]
}

/** Each section's class teacher for a year: they write the report card remarks. */
export function ClassTeachersDialog({
  slug,
  year,
  onDone,
}: {
  slug: string
  year: Year
  onDone: () => void
}) {
  const url = `/orgs/${slug}/academic-years/${year.id}/class-teachers`
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class-teachers", year.id],
    queryFn: () => api<{ sections: LeadSection[] }>(url),
  })
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () =>
      api(url, {
        method: "PUT",
        body: {
          assignments: Object.entries(chosen).map(([groupId, teacherId]) => ({
            groupId,
            teacherId: teacherId || null,
          })),
        },
      }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Class teachers, {year.name}</DialogTitle>
          <DialogDescription>
            The class teacher writes each student&apos;s report card remarks.
            Choose from those who teach the section.
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <Loading error={error} />
        ) : data.sections.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No sections yet.</p>
        ) : (
          <div
            className="grid max-h-[55vh] gap-3 overflow-y-auto pr-1"
            data-testid="class-teachers"
          >
            {data.sections.map((sec) => (
              <Field key={sec.groupId} label={sec.name}>
                <SelectInput
                  value={chosen[sec.groupId] ?? sec.teacherId ?? ""}
                  onChange={(e) =>
                    setChosen({ ...chosen, [sec.groupId]: e.target.value })
                  }
                >
                  <option value="">
                    {sec.options.length
                      ? "No class teacher"
                      : "Nobody teaches it yet"}
                  </option>
                  {sec.options.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ))}
          </div>
        )}
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={Object.keys(chosen).length === 0 || save.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function YearDialog({
  slug,
  year,
  onDone,
}: {
  slug: string
  year: Year | null
  onDone: (changed: boolean) => void
}) {
  const thisYear = new Date().getFullYear()
  const [form, setForm] = useState({
    name: year?.name ?? `${thisYear}-${thisYear + 1}`,
    startsOn: year?.startsOn ?? `${thisYear}-06-01`,
    endsOn: year?.endsOn ?? `${thisYear + 1}-05-31`,
    isCurrent: year?.isCurrent ?? false,
  })
  const save = useMutation({
    mutationFn: () =>
      year
        ? api(`/orgs/${slug}/academic-years/${year.id}`, {
            method: "PATCH",
            body: form,
          })
        : api(`/orgs/${slug}/academic-years`, { body: form }),
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {year ? `Edit ${year.name}` : "Add academic year"}
          </DialogTitle>
          <DialogDescription>
            Groups each student&apos;s class for the year.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="2026-2027"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts">
              <TextInput
                type="date"
                value={form.startsOn}
                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
              />
            </Field>
            <Field label="Ends">
              <TextInput
                type="date"
                value={form.endsOn}
                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
              />
            </Field>
          </div>
          {!year?.isCurrent && (
            <label className="flex items-center gap-2 text-body-sm">
              <Checkbox
                checked={form.isCurrent}
                onCheckedChange={(on) => setForm({ ...form, isCurrent: on })}
              />
              Make this the current academic year
            </label>
          )}
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {year ? "Save changes" : "Add year"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
