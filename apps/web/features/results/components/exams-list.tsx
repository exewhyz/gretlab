"use client"

import {
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  PrinterIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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
import { Progress } from "@workspace/ui/components/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmDialog } from "@/components/confirm"
import {
  Check,
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle, Stats } from "@/features/admin/components/shell"
import { api, ApiRequestError } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { getExam } from "@/features/results/server"
import type { examResults, reportCard } from "@/features/results/server"
import type { listExams } from "@/features/results/server"
import type {
  addPapers,
  addTerm,
  examSettings,
  setPublished,
} from "@/features/results/server"

import { Band, ExamItem, Term, shortDate } from "./results-parts"

export type ExamList = ApiResult<typeof listExams>

export function Exams({ slug }: { slug: string }) {
  const client = useQueryClient()
  const [yearId, setYearId] = useState("")
  const key = ["org", slug, "exams", yearId]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<ExamList>(`/orgs/${slug}/exams${yearId ? `?yearId=${yearId}` : ""}`),
  })
  const [editing, setEditing] = useState<ExamItem | "new" | null>(null)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [bankOpen, setBankOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  if (!data) return <Loading error={error} />
  const parts = data.words?.parts ?? "Terms"
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["org", slug, "exams"] })
  const totalWeight = data.exams.reduce((s, e) => s + e.weight, 0)
  return (
    <>
      <PageTitle
        action={
          data.canSetup &&
          data.year && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setTermsOpen(true)}>
                {parts}
                {(data.terms?.length ?? 0) > 0 && (
                  <span className="tabular-nums opacity-70">
                    {data.terms!.length}
                  </span>
                )}
              </Button>
              <Button variant="outline" onClick={() => setBankOpen(true)}>
                Comment bank
              </Button>
              <Button variant="outline" onClick={() => setScaleOpen(true)}>
                Grading scale
              </Button>
              <Button onClick={() => setEditing("new")}>
                <PlusIcon /> Add exam
              </Button>
            </div>
          )
        }
      >
        {data.words?.assessments ?? "Exams"}
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {data.years.length > 1 && (
          <div className="w-48">
            <Field label="Academic year">
              <SelectInput
                value={data.year?.id ?? ""}
                onChange={(e) => setYearId(e.target.value)}
              >
                {data.years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                    {y.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        )}
        <p className="max-w-2xl text-body-sm text-muted-foreground">
          Each exam has a paper for every subject of every class. Subject
          teachers enter their marks; publishing shows results to students and
          parents.
          {totalWeight > 0 &&
            ` Exams with a weight make up the year's result (${data.exams
              .filter((e) => e.weight > 0)
              .map((e) => `${e.name} ${e.weight}`)
              .join(", ")}).`}
        </p>
      </div>
      {!data.year ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>Add an academic year first</EmptyTitle>
            <EmptyDescription>
              Exams belong to a year. Add one in{" "}
              <Link
                className="underline"
                href={orgPages(slug).manage(`/academic-years`)}
              >
                Academic years
              </Link>
              .
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : data.exams.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No exams in {data.year.name} yet</EmptyTitle>
            <EmptyDescription>
              {data.canSetup
                ? "Add the year's exams, like Unit test 1, Half-yearly and Annual."
                : "Exams the school sets up show here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="exams"
        >
          {data.exams.map((e) => (
            <Card key={e.id} data-testid="exam-card">
              <CardHeader>
                <CardTitle>
                  <Link
                    href={orgPages(slug).manage(`/exams/${e.id}`)}
                    className="hover:underline"
                  >
                    {e.name}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {e.startsOn
                    ? `${shortDate(e.startsOn)}${e.endsOn && e.endsOn !== e.startsOn ? ` – ${shortDate(e.endsOn)}` : ""}`
                    : "No dates"}
                  {e.weight > 0 && ` · weight ${e.weight}`}
                  {e.term && ` · ${e.term}`}
                </CardDescription>
                <CardAction>
                  {e.published ? (
                    <Badge>Published</Badge>
                  ) : (
                    <Badge variant="outline">Draft</Badge>
                  )}
                </CardAction>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3 text-body-sm text-muted-foreground">
                <span>
                  {e.papers} papers · {e.marks} marks in
                </span>
                <div className="flex gap-1">
                  {data.canSetup && !e.published && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${e.name}`}
                      onClick={() => setEditing(e)}
                    >
                      <PencilSimpleIcon />
                    </Button>
                  )}
                  <Link
                    href={orgPages(slug).manage(`/exams/${e.id}`)}
                    className={buttonVariants({
                      size: "sm",
                      variant: "outline",
                    })}
                  >
                    Open
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing && data.year && (
        <ExamDialog
          slug={slug}
          yearId={data.year.id}
          terms={data.terms ?? []}
          partWord={data.words?.part ?? "Term"}
          exam={editing === "new" ? null : editing}
          onDone={(changed) => (setEditing(null), changed && void refresh())}
        />
      )}
      {bankOpen && <BankDialog slug={slug} onDone={() => setBankOpen(false)} />}
      {termsOpen && data.year && (
        <TermsDialog
          slug={slug}
          year={data.year}
          terms={data.terms ?? []}
          parts={parts}
          part={data.words?.part ?? "Term"}
          onDone={(changed) => (setTermsOpen(false), changed && void refresh())}
        />
      )}
      {scaleOpen && (
        <ScaleDialog
          slug={slug}
          scale={data.scale}
          onDone={(changed) => (setScaleOpen(false), changed && void refresh())}
        />
      )}
    </>
  )
}

export function ExamDialog({
  slug,
  yearId,
  terms = [],
  partWord = "Term",
  exam,
  onDone,
}: {
  slug: string
  yearId: string
  terms?: Term[]
  partWord?: string
  exam: Pick<
    ExamItem,
    "id" | "name" | "startsOn" | "endsOn" | "weight" | "termId"
  > | null
  onDone: (changed: boolean) => void
}) {
  const [form, setForm] = useState({
    name: exam?.name ?? "",
    startsOn: exam?.startsOn ?? "",
    endsOn: exam?.endsOn ?? "",
    weight: String(exam?.weight ?? 0),
    termId: exam?.termId ?? "",
  })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        weight: Number(form.weight) || 0,
        termId: form.termId || null,
      }
      return exam
        ? api(`/orgs/${slug}/exams/${exam.id}`, { method: "PATCH", body })
        : api(`/orgs/${slug}/exams`, { body: { ...body, yearId } })
    },
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{exam ? `Edit ${exam.name}` : "Add exam"}</DialogTitle>
          <DialogDescription>
            Add its papers after, for every class at once.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => (e.preventDefault(), save.mutate())}
        >
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Half-yearly"
              autoFocus
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
          {terms.length > 0 && (
            <Field
              label={partWord}
              help={`Its marks count in this ${partWord.toLowerCase()}'s result.`}
            >
              <SelectInput
                value={form.termId}
                onChange={(e) => setForm({ ...form, termId: e.target.value })}
              >
                <option value="">None</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
          <Field
            label="Weight in the year's result"
            help="0 if it doesn't count. Weights are relative: 30 and 70, or 3 and 7."
          >
            <TextInput
              type="number"
              min={0}
              max={100}
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
            />
          </Field>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {exam ? "Save" : "Add exam"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The school's ready-made remarks, one per line. */
/** The year's terms (a college's semesters): add, rename, remove. */
export function TermsDialog({
  slug,
  year,
  terms,
  parts,
  part,
  onDone,
}: {
  slug: string
  year: { id: string; name: string }
  terms: Term[]
  parts: string
  part: string
  onDone: (changed: boolean) => void
}) {
  const [changed, setChanged] = useState(false)
  const [list, setList] = useState(terms)
  const [form, setForm] = useState({
    name: `${part} ${terms.length + 1}`,
    startsOn: "",
    endsOn: "",
  })
  const add = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof addTerm>>(`/orgs/${slug}/exams/terms`, {
        body: { ...form, yearId: year.id },
      }),
    onSuccess: (r) => {
      setList([
        ...list,
        {
          id: r.id,
          name: form.name,
          startsOn: form.startsOn || null,
          endsOn: form.endsOn || null,
        },
      ])
      setForm({ name: `${part} ${list.length + 2}`, startsOn: "", endsOn: "" })
      setChanged(true)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/exams/terms/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      setList(list.filter((t) => t.id !== id))
      setChanged(true)
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(changed)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {parts}, {year.name}
          </DialogTitle>
          <DialogDescription>
            Each {part.toLowerCase()} has its own exams and its own result;
            colleges get an SGPA per {part.toLowerCase()} and a CGPA over them.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1" data-testid="terms">
          {list.length === 0 && (
            <li className="text-body-sm text-muted-foreground">None yet.</li>
          )}
          {list.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2 text-body-sm"
            >
              <span>
                <span className="font-medium text-ink">{t.name}</span>
                {t.startsOn && (
                  <span className="ml-2 text-caption text-muted-foreground">
                    {shortDate(t.startsOn)}
                    {t.endsOn && ` – ${shortDate(t.endsOn)}`}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${t.name}`}
                onClick={() => remove.mutate(t.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="grid gap-3 border-t border-hairline pt-3"
          onSubmit={(e) => (e.preventDefault(), add.mutate())}
        >
          <Field label={`New ${part.toLowerCase()}`}>
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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
          {(add.error || remove.error) && (
            <FormMessage
              message={{
                text: (add.error ?? remove.error)!.message,
                kind: "err",
              }}
            />
          )}
          <DialogFooter>
            <Button type="submit" disabled={add.isPending || !form.name.trim()}>
              Add {part.toLowerCase()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function BankDialog({
  slug,
  onDone,
}: {
  slug: string
  onDone: () => void
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "exam-settings"],
    queryFn: () =>
      api<ApiResult<typeof examSettings>>(`/orgs/${slug}/exams/settings`),
  })
  const client = useQueryClient()
  const [text, setText] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/exams/settings`, {
        method: "PUT",
        body: { remarks: (text ?? "").split("\n") },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug] })
      onDone()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Comment bank</DialogTitle>
          <DialogDescription>
            Remarks teachers can pick from, one per line. {"{name}"} becomes the
            student&apos;s first name.
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <Loading error={error} />
        ) : (
          <Field label="Remarks">
            <TextArea
              className="min-h-64"
              value={text ?? data.remarks.join("\n")}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        )}
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={text === null || save.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ScaleDialog({
  slug,
  scale,
  onDone,
}: {
  slug: string
  scale: Band[]
  onDone: (changed: boolean) => void
}) {
  const [rows, setRows] = useState(
    scale.map((b) => ({
      grade: b.grade,
      min: String(b.min),
      points: b.points == null ? "" : String(b.points),
    }))
  )
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/exams/settings`, {
        method: "PUT",
        body: {
          scale: rows.map((r) => ({
            grade: r.grade,
            min: Number(r.min),
            points: r.points === "" ? null : Number(r.points),
          })),
        },
      }),
    onSuccess: () => onDone(true),
  })
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Grading scale</DialogTitle>
          <DialogDescription>
            A grade starts at its percentage. The lowest starts at 0%.
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid max-h-[55vh] gap-2 overflow-y-auto"
          data-testid="scale"
        >
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-caption font-semibold">
            <span>Grade</span>
            <span>From %</span>
            <span>Points</span>
            <span className="w-8" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <TextInput
                aria-label={`Grade ${i + 1}`}
                value={r.grade}
                onChange={(e) => set(i, { grade: e.target.value })}
              />
              <TextInput
                aria-label={`Grade ${i + 1} from`}
                type="number"
                min={0}
                max={100}
                value={r.min}
                onChange={(e) => set(i, { min: e.target.value })}
              />
              <TextInput
                aria-label={`Grade ${i + 1} points`}
                type="number"
                min={0}
                value={r.points}
                onChange={(e) => set(i, { points: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove grade ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setRows([...rows, { grade: "", min: "", points: "" }])}
        >
          <PlusIcon /> Add grade
        </Button>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save scale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
