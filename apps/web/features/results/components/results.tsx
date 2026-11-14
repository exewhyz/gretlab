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

/* ---------- shared ---------- */

interface Band {
  min: number
  grade: string
  points?: number | null
}

const shortDate = (day: string | null) =>
  day
    ? new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : ""

const fmt = (n: number | null | undefined) =>
  n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1)

const RESULT: Record<string, { label: string; tone: string }> = {
  pass: { label: "Pass", tone: "text-success" },
  fail: { label: "Needs to improve", tone: "text-destructive" },
  incomplete: { label: "Marks pending", tone: "text-muted-foreground" },
  none: { label: "–", tone: "text-muted-foreground" },
}

/* ---------- Manage › Exams ---------- */

interface ExamItem {
  id: string
  name: string
  startsOn: string | null
  endsOn: string | null
  weight: number
  termId?: string | null
  term?: string | null
  published: boolean
  papers: number
  marks: number
}

interface Term {
  id: string
  name: string
  startsOn: string | null
  endsOn: string | null
}

type ExamList = ApiResult<typeof listExams>

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

function ExamDialog({
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
function TermsDialog({
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

function BankDialog({ slug, onDone }: { slug: string; onDone: () => void }) {
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

function ScaleDialog({
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

/* ---------- one exam ---------- */

interface Paper {
  id: string
  subjectId: string
  subject: string
  maxMarks: number
  passMarks: number
  heldOn: string | null
  teacher: string | null
  entered: number
  canMark: boolean
}

type ExamDetail = ApiResult<typeof getExam>

export function ExamPage({ slug, examId }: { slug: string; examId: string }) {
  const client = useQueryClient()
  const router = useRouter()
  const key = ["org", slug, "exam", examId]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<ExamDetail>(`/orgs/${slug}/exams/${examId}`),
  })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editPaper, setEditPaper] = useState<Paper | null>(null)
  const [confirm, setConfirm] = useState<
    "publish" | "force" | "unpublish" | "delete" | null
  >(null)
  const [missing, setMissing] = useState("")
  const refresh = () => client.invalidateQueries({ queryKey: ["org", slug] })
  const publish = useMutation({
    mutationFn: (v: { published: boolean; force?: boolean }) =>
      api<ApiResult<typeof setPublished>>(
        `/orgs/${slug}/exams/${examId}/publish`,
        { body: v }
      ),
    onSuccess: () => void refresh(),
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === "incomplete") {
        setMissing(e.message)
        setConfirm("force")
      }
    },
  })
  const remove = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/exams/${examId}`, { method: "DELETE" }),
    onSuccess: () => router.push(orgPages(slug).manage(`/exams`)),
  })
  if (!data) return <Loading error={error} />
  const { exam } = data
  const resultClasses = data.classes.filter((c) => c.canSeeResults)
  const papers = data.classes.flatMap((c) =>
    c.papers.map((p) => ({ ...p, total: c.students }))
  )
  const entered = papers.reduce((s, p) => s + Math.min(p.entered, p.total), 0)
  const expected = papers.reduce((s, p) => s + p.total, 0)
  return (
    <>
      <div className="mb-1 text-body-sm text-muted-foreground">
        <Link
          href={orgPages(slug).manage(`/exams`)}
          className="hover:underline"
        >
          Exams
        </Link>{" "}
        · {data.year?.name}
      </div>
      <PageTitle
        action={
          data.canSetup && (
            <div className="flex flex-wrap gap-2">
              {exam.published ? (
                <Button
                  variant="outline"
                  onClick={() => setConfirm("unpublish")}
                >
                  Unpublish
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setAdding(true)}>
                    <PlusIcon /> Add papers
                  </Button>
                  <Button
                    onClick={() => setConfirm("publish")}
                    disabled={papers.length === 0}
                  >
                    Publish results
                  </Button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="More actions"
                    />
                  }
                >
                  <DotsThreeIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={exam.published}
                    onClick={() => setEditing(true)}
                  >
                    Edit exam
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={exam.published}
                    onClick={() => setConfirm("delete")}
                  >
                    Delete exam
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      >
        <span className="mr-2">{exam.name}</span>
        {exam.published ? (
          <Badge data-testid="exam-status">Published</Badge>
        ) : (
          <Badge variant="outline" data-testid="exam-status">
            Draft
          </Badge>
        )}
      </PageTitle>
      {(publish.error || remove.error) && !missing && (
        <FormMessage
          message={{
            text: (publish.error ?? remove.error)!.message,
            kind: "err",
          }}
        />
      )}
      {publish.data?.published && (
        <FormMessage
          message={{
            text: `Published. ${publish.data.told} students were told.`,
            kind: "ok",
          }}
        />
      )}
      {exam.published && (
        <p className="mb-3 text-body-sm text-muted-foreground">
          Students and parents can see these results. Marks are locked until
          it&apos;s unpublished.
        </p>
      )}
      {expected > 0 && (
        <div className="mb-4 flex max-w-md items-center gap-3 text-body-sm">
          <Progress value={(100 * entered) / expected} className="flex-1" />
          <span className="text-muted-foreground tabular-nums">
            {entered} of {expected} marks in
          </span>
        </div>
      )}
      <Tabs defaultValue="papers">
        <TabsList>
          <TabsTrigger value="papers">Papers</TabsTrigger>
          {resultClasses.length > 0 && (
            <TabsTrigger value="results">Results</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="papers" className="mt-3">
          {data.classes.length === 0 ? (
            <Empty className="border border-dashed border-hairline">
              <EmptyHeader>
                <EmptyTitle>No papers yet</EmptyTitle>
                <EmptyDescription>
                  {data.canSetup
                    ? "Add papers: choose classes and the full and pass marks, and every subject they take gets one."
                    : "Papers you can enter marks for show here."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {data.classes.map((c) => (
                <Card key={c.groupId} className="pb-0" data-testid="exam-class">
                  <CardHeader>
                    <CardTitle>{c.name}</CardTitle>
                    <CardDescription>
                      {c.students} students
                      {c.classTeacher && ` · Class teacher ${c.classTeacher}`}
                    </CardDescription>
                    {(c.canRemark || c.canSeeResults) && (
                      <CardAction>
                        <Link
                          aria-label={`Remarks for ${c.name}`}
                          href={orgPages(slug).manage(
                            `/exams/${examId}/remarks/${c.groupId}`
                          )}
                          className={buttonVariants({
                            size: "sm",
                            variant: "outline",
                          })}
                        >
                          Remarks {Math.min(c.remarks, c.students)}/{c.students}
                        </Link>
                      </CardAction>
                    )}
                  </CardHeader>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead className="hidden sm:table-cell">
                          Teacher
                        </TableHead>
                        <TableHead className="text-right">Marks</TableHead>
                        <TableHead className="text-right">In</TableHead>
                        <TableHead className="w-10">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {c.papers.map((p) => (
                        <TableRow key={p.id} data-testid="paper-row">
                          <TableCell className="font-medium">
                            {p.canMark || c.canSeeResults ? (
                              <Link
                                className="hover:underline"
                                href={orgPages(slug).manage(
                                  `/exams/${examId}/papers/${p.id}`
                                )}
                              >
                                {p.subject}
                              </Link>
                            ) : (
                              p.subject
                            )}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground sm:table-cell">
                            {p.teacher ?? "–"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.maxMarks}
                            <span className="text-muted-foreground">
                              {" "}
                              / pass {fmt(p.passMarks)}
                            </span>
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              p.entered >= c.students && c.students > 0
                                ? "text-success"
                                : "text-muted-foreground"
                            )}
                          >
                            {Math.min(p.entered, c.students)}/{c.students}
                          </TableCell>
                          <TableCell>
                            {p.canMark && !exam.published ? (
                              <Link
                                aria-label={`Enter marks for ${p.subject}, ${c.name}`}
                                href={orgPages(slug).manage(
                                  `/exams/${examId}/papers/${p.id}`
                                )}
                                className={buttonVariants({
                                  size: "sm",
                                  variant: "ghost",
                                })}
                              >
                                Enter
                              </Link>
                            ) : null}
                            {data.canSetup && !exam.published && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Edit ${p.subject}, ${c.name}`}
                                onClick={() => setEditPaper(p)}
                              >
                                <PencilSimpleIcon />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        {resultClasses.length > 0 && (
          <TabsContent value="results" className="mt-3">
            <ClassResults
              slug={slug}
              examId={examId}
              yearId={data.year?.id ?? ""}
              classes={resultClasses}
            />
          </TabsContent>
        )}
      </Tabs>
      {adding && (
        <PapersDialog
          slug={slug}
          examId={examId}
          sections={data.sections}
          grades={data.grades}
          onDone={(changed) => (setAdding(false), changed && void refresh())}
        />
      )}
      {editing && (
        <ExamDialog
          slug={slug}
          yearId={data.year?.id ?? ""}
          exam={exam}
          onDone={(changed) => (setEditing(false), changed && void refresh())}
        />
      )}
      {editPaper && (
        <PaperDialog
          slug={slug}
          paper={editPaper}
          onDone={(changed) => (setEditPaper(null), changed && void refresh())}
        />
      )}
      {confirm === "publish" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={`Publish the results of ${exam.name}?`}
          description="Students and their parents are told and can see their report cards. Marks are locked until you unpublish."
          confirmLabel="Publish"
          tone="default"
          onConfirm={() => (
            setMissing(""),
            publish.mutate({ published: true })
          )}
        />
      )}
      {confirm === "force" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && (setConfirm(null), setMissing(""))}
          title="Some marks aren't in"
          description={missing}
          confirmLabel="Publish anyway"
          tone="default"
          onConfirm={() => {
            setMissing("")
            publish.mutate({ published: true, force: true })
          }}
        />
      )}
      {confirm === "unpublish" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={`Unpublish ${exam.name}?`}
          description="Students and parents stop seeing these results, and marks can be changed again."
          confirmLabel="Unpublish"
          tone="default"
          onConfirm={() => publish.mutate({ published: false })}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={`Delete ${exam.name}?`}
          description="Its papers and every mark entered are deleted. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => remove.mutate()}
        />
      )}
    </>
  )
}

function PapersDialog({
  slug,
  examId,
  sections,
  grades,
  onDone,
}: {
  slug: string
  examId: string
  sections: { id: string; name: string }[]
  grades: { id: string; name: string }[]
  onDone: (changed: boolean) => void
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({ maxMarks: "100", passMarks: "33" })
  const save = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof addPapers>>(`/orgs/${slug}/exams/${examId}/papers`, {
        body: {
          groupIds: [...chosen],
          maxMarks: Number(form.maxMarks),
          passMarks: Number(form.passMarks),
        },
      }),
  })
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(id)
    else next.delete(id)
    setChosen(next)
  }
  // A grade's sections are listed under it.
  const under = (g: { name: string }) =>
    sections.filter((s) => s.name.startsWith(`${g.name} › `))
  const loose = sections.filter(
    (s) => !grades.some((g) => s.name.startsWith(`${g.name} › `))
  )
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(!!save.data)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add papers</DialogTitle>
          <DialogDescription>
            Every subject a chosen class takes gets a paper. Papers already
            there are left as they are.
          </DialogDescription>
        </DialogHeader>
        {save.data ? (
          <>
            <p className="text-body-sm" data-testid="papers-added">
              Added {save.data.added} papers
              {save.data.skipped
                ? `; ${save.data.skipped} were already there`
                : ""}
              .
            </p>
            <DialogFooter>
              <Button onClick={() => onDone(true)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="grid max-h-[45vh] gap-1 overflow-y-auto rounded-lg border border-hairline p-3">
              {grades.map((g) => (
                <Fragment key={g.id}>
                  <Check
                    label={g.name}
                    checked={chosen.has(g.id)}
                    onCheckedChange={(v) => toggle(g.id, v)}
                  >
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      (all sections)
                    </span>
                  </Check>
                  {under(g).map((s) => (
                    <Check
                      key={s.id}
                      className="pl-6"
                      label={s.name}
                      disabled={chosen.has(g.id)}
                      checked={chosen.has(g.id) || chosen.has(s.id)}
                      onCheckedChange={(v) => toggle(s.id, v)}
                    />
                  ))}
                </Fragment>
              ))}
              {loose.map((s) => (
                <Check
                  key={s.id}
                  label={s.name}
                  checked={chosen.has(s.id)}
                  onCheckedChange={(v) => toggle(s.id, v)}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full marks">
                <TextInput
                  type="number"
                  min={1}
                  value={form.maxMarks}
                  onChange={(e) =>
                    setForm({ ...form, maxMarks: e.target.value })
                  }
                />
              </Field>
              <Field label="Pass marks">
                <TextInput
                  type="number"
                  min={0}
                  step="0.5"
                  value={form.passMarks}
                  onChange={(e) =>
                    setForm({ ...form, passMarks: e.target.value })
                  }
                />
              </Field>
            </div>
            {save.error && (
              <FormMessage
                message={{ text: save.error.message, kind: "err" }}
              />
            )}
            <DialogFooter>
              <Button
                onClick={() => save.mutate()}
                disabled={chosen.size === 0 || save.isPending}
              >
                Add papers
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PaperDialog({
  slug,
  paper,
  onDone,
}: {
  slug: string
  paper: Paper
  onDone: (changed: boolean) => void
}) {
  const [form, setForm] = useState({
    maxMarks: String(paper.maxMarks),
    passMarks: String(paper.passMarks),
    heldOn: paper.heldOn ?? "",
  })
  const [removing, setRemoving] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/exam-papers/${paper.id}`, {
        method: "PATCH",
        body: {
          maxMarks: Number(form.maxMarks),
          passMarks: Number(form.passMarks),
          heldOn: form.heldOn,
        },
      }),
    onSuccess: () => onDone(true),
  })
  const remove = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/exam-papers/${paper.id}`, { method: "DELETE" }),
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{paper.subject}</DialogTitle>
          <DialogDescription>
            Full and pass marks, and the day.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full marks">
            <TextInput
              type="number"
              value={form.maxMarks}
              onChange={(e) => setForm({ ...form, maxMarks: e.target.value })}
            />
          </Field>
          <Field label="Pass marks">
            <TextInput
              type="number"
              step="0.5"
              value={form.passMarks}
              onChange={(e) => setForm({ ...form, passMarks: e.target.value })}
            />
          </Field>
          <Field label="Held on">
            <TextInput
              type="date"
              value={form.heldOn}
              onChange={(e) => setForm({ ...form, heldOn: e.target.value })}
            />
          </Field>
        </div>
        {(save.error || remove.error) && (
          <FormMessage
            message={{
              text: (save.error ?? remove.error)!.message,
              kind: "err",
            }}
          />
        )}
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => setRemoving(true)}
          >
            Remove paper
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
        {removing && (
          <ConfirmDialog
            open
            onOpenChange={(open) => !open && setRemoving(false)}
            title={`Remove ${paper.subject}?`}
            description="Its marks are deleted too."
            confirmLabel="Remove"
            onConfirm={() => remove.mutate()}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------- a class's results ---------- */

type ResultsData = ApiResult<typeof examResults>

function ClassResults({
  slug,
  examId,
  yearId,
  classes,
}: {
  slug: string
  examId: string
  yearId: string
  classes: { groupId: string; name: string }[]
}) {
  const [groupId, setGroupId] = useState(classes[0]!.groupId)
  const { data, error } = useQuery({
    queryKey: ["org", slug, "exam", examId, "results", groupId],
    queryFn: () =>
      api<ResultsData>(
        `/orgs/${slug}/exams/${examId}/results?groupId=${groupId}`
      ),
  })
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-64">
          <Field label="Class">
            <SelectInput
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.groupId} value={c.groupId}>
                  {c.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <a
          href={`/api/v1/orgs/${slug}/report-cards/class/${groupId}/pdf?yearId=${yearId}`}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline" })}
          data-testid="class-report-pdf"
        >
          All report cards (PDF)
        </a>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            data-testid="result-stats"
          >
            {[
              ["Students", String(data.stats.students)],
              [
                "Passed",
                data.stats.complete
                  ? `${data.stats.passed} of ${data.stats.complete}`
                  : "–",
              ],
              [
                "Class average",
                data.stats.average == null
                  ? "–"
                  : `${fmt(data.stats.average)}%`,
              ],
              [
                "Highest",
                data.stats.highest == null
                  ? "–"
                  : `${fmt(data.stats.highest)}%`,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-hairline bg-card p-3"
              >
                <div className="text-caption text-muted-foreground">
                  {label}
                </div>
                <div className="text-title-md text-ink tabular-nums">
                  {value}
                </div>
              </div>
            ))}
          </div>
          <Card className="overflow-x-auto py-0">
            <Table data-testid="results">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Roll</TableHead>
                  <TableHead>Student</TableHead>
                  {data.papers.map((p) => (
                    <TableHead key={p.id} className="text-right">
                      {p.subject}
                      <div className="font-normal text-muted-foreground">
                        /{p.maxMarks}
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Rank</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id} data-testid="result-row">
                    <TableCell className="text-muted-foreground tabular-nums">
                      {r.rollNo ?? "–"}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        className="hover:underline"
                        href={orgPages(slug).results(r.id)}
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    {r.cells.map((c) => (
                      <TableCell
                        key={c.paperId}
                        className={cn(
                          "text-right tabular-nums",
                          (c.outcome === "fail" || c.outcome === "absent") &&
                            "text-destructive"
                        )}
                      >
                        {c.absent ? "AB" : fmt(c.marks)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">
                      {fmt(r.obtained)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(r.percent)}
                    </TableCell>
                    <TableCell>{r.grade ?? "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.rank ?? "–"}
                    </TableCell>
                    <TableCell className={RESULT[r.result]?.tone}>
                      {RESULT[r.result]?.label}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell />
                  <TableCell className="text-muted-foreground">
                    Average
                  </TableCell>
                  {data.stats.subjects.map((s) => (
                    <TableCell
                      key={s.paperId}
                      className="text-right text-muted-foreground tabular-nums"
                    >
                      {fmt(s.average)}
                    </TableCell>
                  ))}
                  <TableCell colSpan={5} />
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}

/* ---------- entering marks ---------- */

interface Sheet {
  paper: {
    id: string
    subject: string
    class: string
    maxMarks: number
    passMarks: number
    heldOn: string | null
  }
  exam: { id: string; name: string; published: boolean }
  canMark: boolean
  students: {
    id: string
    name: string
    rollNo: number | null
    admissionNo: string | null
    status: string
    marks: number | null
    absent: boolean
    remark: string
  }[]
}

const markError = (text: string, max: number) => {
  if (text.trim() === "") return null
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0) return "Not a mark"
  if (n > max) return `At most ${max}`
  if (Math.round(n * 2) !== n * 2) return "Halves only"
  return null
}

export function MarksSheet({
  slug,
  examId,
  paperId,
}: {
  slug: string
  examId: string
  paperId: string
}) {
  const client = useQueryClient()
  const key = ["org", slug, "paper", paperId]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Sheet>(`/orgs/${slug}/exam-papers/${paperId}/marks`),
  })
  const [draft, setDraft] = useState<
    Record<string, { text: string; absent: boolean; remark: string }>
  >({})
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  useEffect(() => {
    if (!data) return
    setDraft(
      Object.fromEntries(
        data.students.map((s) => [
          s.id,
          {
            text: s.marks == null ? "" : String(s.marks),
            absent: s.absent,
            remark: s.remark,
          },
        ])
      )
    )
  }, [data])
  const dirty = useMemo(
    () =>
      data?.students.filter((s) => {
        const d = draft[s.id]
        if (!d) return false
        const was = s.marks == null ? "" : String(s.marks)
        return (
          d.absent !== s.absent ||
          (!d.absent && d.text.trim() !== was) ||
          d.remark.trim() !== s.remark
        )
      }) ?? [],
    [data, draft]
  )
  const save = useMutation({
    mutationFn: () =>
      api<Sheet>(`/orgs/${slug}/exam-papers/${paperId}/marks`, {
        method: "PUT",
        body: {
          marks: dirty.map((s) => {
            const d = draft[s.id]!
            return {
              userId: s.id,
              absent: d.absent,
              marks: d.absent || d.text.trim() === "" ? null : Number(d.text),
              remark: d.remark.trim(),
            }
          }),
        },
      }),
    onSuccess: (sheet) => {
      client.setQueryData(key, sheet)
      void client.invalidateQueries({ queryKey: ["org", slug, "exam", examId] })
    },
  })
  // Leaving with unsaved marks asks first.
  useEffect(() => {
    if (dirty.length === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty.length])
  if (!data) return <Loading error={error} />
  const { paper } = data
  const errors = data.students.map((s) =>
    draft[s.id] && !draft[s.id]!.absent
      ? markError(draft[s.id]!.text, paper.maxMarks)
      : null
  )
  const bad = errors.some(Boolean)
  const entered = data.students.filter((s) => {
    const d = draft[s.id]
    return d && (d.absent || d.text.trim() !== "")
  }).length
  // The paper as it stands (unsaved changes included): what a teacher checks before saving.
  const scores = data.students
    .map((s, i) => {
      const d = draft[s.id]
      if (!d || d.absent || d.text.trim() === "" || errors[i]) return null
      return Number(d.text)
    })
    .filter((n): n is number => n !== null && Number.isFinite(n))
  const absent = data.students.filter((s) => draft[s.id]?.absent).length
  const below = scores.filter((n) => n < paper.passMarks).length
  const mean = scores.length
    ? scores.reduce((t, n) => t + n, 0) / scores.length
    : null
  return (
    <>
      <div className="mb-1 text-body-sm text-muted-foreground">
        <Link
          href={orgPages(slug).manage(`/exams`)}
          className="hover:underline"
        >
          Exams
        </Link>{" "}
        ·{" "}
        <Link
          href={orgPages(slug).manage(`/exams/${examId}`)}
          className="hover:underline"
        >
          {data.exam.name}
        </Link>
      </div>
      <PageTitle
        action={
          data.canMark && (
            <Button
              onClick={() => save.mutate()}
              disabled={dirty.length === 0 || bad || save.isPending}
            >
              {dirty.length ? `Save ${dirty.length} changes` : "Saved"}
            </Button>
          )
        }
      >
        {paper.subject} · {paper.class}
      </PageTitle>
      <p className="mb-3 text-body-sm text-muted-foreground">
        Out of {paper.maxMarks}, pass {fmt(paper.passMarks)}. {entered} of{" "}
        {data.students.length} entered.{" "}
        {data.exam.published
          ? "The results are published, so marks are locked."
          : !data.canMark
            ? "Only the subject teacher can enter these."
            : "Press Enter to go to the next student. Halves are allowed."}
      </p>
      {data.students.length > 0 && (
        <Stats
          items={[
            {
              label: "Entered",
              value: entered,
              hint: `of ${data.students.length}`,
            },
            {
              label: "Average",
              value: mean === null ? "—" : fmt(Math.round(mean * 10) / 10),
              hint:
                mean === null
                  ? undefined
                  : `${Math.round((100 * mean) / paper.maxMarks)}%`,
            },
            {
              label: "Highest",
              value: scores.length ? fmt(Math.max(...scores)) : "—",
            },
            {
              label: `Below pass (${fmt(paper.passMarks)})`,
              value: below,
              tone: below > 0 ? "bad" : undefined,
            },
            { label: "Absent", value: absent },
          ]}
        />
      )}
      {save.error && (
        <FormMessage message={{ text: save.error.message, kind: "err" }} />
      )}
      {save.isSuccess && dirty.length === 0 && (
        <FormMessage message={{ text: "Marks saved.", kind: "ok" }} />
      )}
      {data.students.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No students in this class that year</EmptyTitle>
            <EmptyDescription>
              Students are placed in Manage › Students.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table data-testid="marks">
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Roll</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="w-32">Marks</TableHead>
                <TableHead className="w-20">Absent</TableHead>
                <TableHead className="hidden md:table-cell">Remark</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.students.map((s, i) => {
                const d = draft[s.id] ?? { text: "", absent: false, remark: "" }
                const err = errors[i]
                const n = Number(d.text)
                const fails =
                  !d.absent &&
                  d.text.trim() !== "" &&
                  !err &&
                  n < paper.passMarks
                return (
                  <TableRow key={s.id} data-testid="mark-row">
                    <TableCell className="text-muted-foreground tabular-nums">
                      {s.rollNo ?? "–"}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-caption text-muted-foreground">
                        {s.admissionNo}
                        {s.status !== "active" && ` · ${s.status}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TextInput
                        ref={(el) => {
                          inputs.current[i] = el
                        }}
                        inputMode="decimal"
                        aria-label={`Marks for ${s.name}`}
                        aria-invalid={!!err}
                        disabled={!data.canMark || d.absent}
                        value={d.absent ? "" : d.text}
                        placeholder={d.absent ? "AB" : ""}
                        className={cn(
                          "w-24 tabular-nums",
                          fails && "text-destructive"
                        )}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [s.id]: { ...d, text: e.target.value },
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            inputs.current
                              .slice(i + 1)
                              .find((x) => x && !x.disabled)
                              ?.focus()
                          }
                        }}
                      />
                      {err && (
                        <div className="mt-1 text-caption text-destructive">
                          {err}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        aria-label={`${s.name} was absent`}
                        disabled={!data.canMark}
                        checked={d.absent}
                        onCheckedChange={(v) =>
                          setDraft({
                            ...draft,
                            [s.id]: { ...d, absent: v === true },
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <TextInput
                        aria-label={`Remark for ${s.name}`}
                        maxLength={200}
                        disabled={!data.canMark}
                        value={d.remark}
                        placeholder="Optional"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [s.id]: { ...d, remark: e.target.value },
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  )
}

/* ---------- report card ---------- */

type ReportCardData = ApiResult<typeof reportCard>

export function ReportCard({
  slug,
  studentId,
}: {
  slug: string
  studentId: string
}) {
  const [yearId, setYearId] = useState("")
  const { data, error } = useQuery({
    queryKey: ["org", slug, "report-card", studentId, yearId],
    queryFn: () =>
      api<ReportCardData>(
        `/orgs/${slug}/report-cards/${studentId}${yearId ? `?yearId=${yearId}` : ""}`
      ),
  })
  if (!data) return <Loading error={error} />
  const weighted = data.exams.some((e) => e.weight > 0)
  return (
    <>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #report-card, #report-card * { visibility: visible !important; }
        #report-card { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0; }
        @page { margin: 14mm; }
      }`}</style>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
        {data.years.length > 1 ? (
          <div className="w-48">
            <Field label="Academic year">
              <SelectInput
                value={data.year.id}
                onChange={(e) => setYearId(e.target.value)}
              >
                {data.years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <a
            href={`/api/v1/orgs/${slug}/report-cards/${studentId}/pdf?yearId=${data.year.id}`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
            data-testid="report-pdf"
          >
            Download PDF
          </a>
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon /> Print
          </Button>
        </div>
      </div>
      <article
        id="report-card"
        data-testid="report-card"
        className="mx-auto grid max-w-4xl gap-5 rounded-xl border border-hairline bg-card p-5 sm:p-8"
      >
        <header className="grid gap-1 border-b border-hairline pb-4 text-center">
          <div className="text-title-lg text-ink">{data.org.name}</div>
          <div className="text-body-sm tracking-wide text-muted-foreground uppercase">
            Report card · {data.year.name}
          </div>
        </header>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm sm:grid-cols-4">
          {[
            ["Student", data.student.name],
            ["Admission no.", data.student.admissionNo ?? "–"],
            ["Class", data.year.class ?? "–"],
            [
              "Roll no.",
              data.year.rollNo == null ? "–" : String(data.year.rollNo),
            ],
            ...(data.year.classTeacher
              ? [["Class teacher", data.year.classTeacher]]
              : []),
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-caption text-muted-foreground">{k}</dt>
              <dd className="font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {data.credits && data.credits.terms.length > 0 && (
          <section className="grid gap-4" data-testid="grade-card">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-title-sm text-ink">Grade card</h2>
              <div className="flex gap-4 text-body-sm">
                <span>
                  CGPA{" "}
                  <span
                    className="text-title-md font-semibold text-ink tabular-nums"
                    data-testid="cgpa"
                  >
                    {data.credits.cgpa == null
                      ? "–"
                      : data.credits.cgpa.toFixed(2)}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {data.credits.earned} credits earned
                </span>
              </div>
            </div>
            {data.credits.terms.map((t) => (
              <div key={t.id} className="grid gap-2" data-testid="grade-term">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium text-ink">{t.name}</h3>
                  <span className="text-body-sm text-muted-foreground">
                    SGPA{" "}
                    <span
                      className="font-semibold text-ink tabular-nums"
                      data-testid="sgpa"
                    >
                      {t.sgpa == null ? "–" : t.sgpa.toFixed(2)}
                    </span>
                    {" · "}
                    {t.earned} of {t.credits} credits
                    {t.backlogs > 0 && (
                      <span className="text-destructive">
                        {" "}
                        · {t.backlogs} backlog{t.backlogs === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-body-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left text-caption text-muted-foreground">
                        <th className="py-1.5 pr-3 font-medium">Code</th>
                        <th className="py-1.5 pr-3 font-medium">Course</th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          Credits
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          Grade
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          Points
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.courses.map((c) => (
                        <tr
                          key={c.subjectId}
                          className="border-b border-hairline/60"
                        >
                          <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">
                            {c.code || "–"}
                          </td>
                          <td className="py-1.5 pr-3 text-ink">{c.name}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {c.credits ?? "–"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5 text-right font-medium",
                              c.points === 0 && "text-destructive"
                            )}
                          >
                            {c.grade ?? "–"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {c.points ?? "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        )}
        {data.exams.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-muted-foreground">
            No results published for {data.year.name} yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-body-sm"
              data-testid="report-table"
            >
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="py-2 pr-3 font-semibold">Subject</th>
                  {data.exams.map((e) => (
                    <th
                      key={e.id}
                      className="px-2 py-2 text-right font-semibold"
                      colSpan={2}
                    >
                      {e.name}
                      {!e.published && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          (draft)
                        </span>
                      )}
                      {e.weight > 0 && (
                        <div className="font-normal text-muted-foreground">
                          weight {e.weight}
                        </div>
                      )}
                    </th>
                  ))}
                  {weighted && (
                    <th
                      className="px-2 py-2 text-right font-semibold"
                      colSpan={2}
                    >
                      Year
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.subjects.map((s) => (
                  <tr
                    key={s.subjectId}
                    className="border-b border-hairline/60"
                    data-testid="report-subject"
                  >
                    <td className="py-2 pr-3 font-medium text-ink">{s.name}</td>
                    {data.exams.map((e) => {
                      const p = e.papers.find(
                        (x) => x.subjectId === s.subjectId
                      )
                      return (
                        <Fragment key={e.id}>
                          <td
                            className={cn(
                              "px-2 py-2 text-right tabular-nums",
                              (p?.outcome === "fail" ||
                                p?.outcome === "absent") &&
                                "text-destructive"
                            )}
                          >
                            {!p
                              ? ""
                              : p.absent
                                ? "AB"
                                : p.marks == null
                                  ? "–"
                                  : `${fmt(p.marks)}/${p.maxMarks}`}
                          </td>
                          <td className="px-2 py-2 text-right text-muted-foreground">
                            {p?.grade ?? ""}
                          </td>
                        </Fragment>
                      )
                    })}
                    {weighted && (
                      <>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {s.final == null ? "–" : `${fmt(s.final)}%`}
                        </td>
                        <td className="px-2 py-2 text-right font-medium">
                          {s.grade ?? ""}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink/20 font-medium">
                  <td className="py-2 pr-3">Total</td>
                  {data.exams.map((e) => (
                    <Fragment key={e.id}>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {e.maxMarks ? `${fmt(e.obtained)}/${e.maxMarks}` : "–"}
                      </td>
                      <td className="px-2 py-2 text-right">{e.grade ?? ""}</td>
                    </Fragment>
                  ))}
                  {weighted && (
                    <>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        data-testid="report-final"
                      >
                        {data.final ? `${fmt(data.final.percent)}%` : "–"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {data.final?.grade ?? ""}
                      </td>
                    </>
                  )}
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-1 pr-3">Percentage</td>
                  {data.exams.map((e) => (
                    <td
                      key={e.id}
                      className="px-2 py-1 text-right tabular-nums"
                      colSpan={2}
                    >
                      {e.percent == null ? "–" : `${fmt(e.percent)}%`}
                    </td>
                  ))}
                  {weighted && <td colSpan={2} />}
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-1 pr-3">Rank in class</td>
                  {data.exams.map((e) => (
                    <td
                      key={e.id}
                      className="px-2 py-1 text-right tabular-nums"
                      colSpan={2}
                    >
                      {e.rank == null ? "–" : `${e.rank} of ${e.of}`}
                    </td>
                  ))}
                  {weighted && <td colSpan={2} />}
                </tr>
                <tr>
                  <td className="py-1 pr-3 text-muted-foreground">Result</td>
                  {data.exams.map((e) => (
                    <td
                      key={e.id}
                      className={cn(
                        "px-2 py-1 text-right",
                        RESULT[e.result]?.tone
                      )}
                      colSpan={2}
                      data-testid="report-result"
                    >
                      {RESULT[e.result]?.label}
                    </td>
                  ))}
                  {weighted && <td colSpan={2} />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {data.exams.some((e) => e.remark || e.subjectRemarks.length > 0) && (
          <section className="grid gap-3" data-testid="report-remarks">
            <h2 className="text-title-sm text-ink">Remarks</h2>
            {data.exams
              .filter((e) => e.remark || e.subjectRemarks.length > 0)
              .map((e) => (
                <div key={e.id} className="grid gap-1 text-body-sm">
                  <div className="font-medium text-ink">{e.name}</div>
                  {e.remark && <p className="text-ink">{e.remark}</p>}
                  {e.subjectRemarks.length > 0 && (
                    <ul className="grid gap-0.5 text-muted-foreground">
                      {e.subjectRemarks.map((r) => (
                        <li key={r.subject}>
                          <span className="font-medium text-ink">
                            {r.subject}:
                          </span>{" "}
                          {r.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
          </section>
        )}
        <footer className="grid gap-1 border-t border-hairline pt-3 text-caption text-muted-foreground">
          <div>
            Grades: {data.scale.map((b) => `${b.grade} ${b.min}%+`).join(" · ")}
            . AB: absent.
          </div>
        </footer>
      </article>
    </>
  )
}

/* ---------- overall remarks ---------- */

interface RemarksData {
  exam: { id: string; name: string; published: boolean }
  class: { id: string; name: string }
  classTeacher: string | null
  canWrite: boolean
  bank: string[]
  students: {
    id: string
    name: string
    rollNo: number | null
    percent: number | null
    grade: string | null
    result: string
    rank: number | null
    remark: string
    subjects: { subject: string; text: string }[]
  }[]
}

const fill = (template: string, name: string) =>
  template.replaceAll("{name}", name.trim().split(/\s+/)[0] || "The student")

export function RemarksSheet({
  slug,
  examId,
  groupId,
}: {
  slug: string
  examId: string
  groupId: string
}) {
  const client = useQueryClient()
  const key = ["org", slug, "remarks", examId, groupId]
  const url = `/orgs/${slug}/exams/${examId}/remarks/${groupId}`
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<RemarksData>(url),
  })
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => {
    if (data)
      setDraft(Object.fromEntries(data.students.map((s) => [s.id, s.remark])))
  }, [data])
  const dirty = useMemo(
    () =>
      data?.students.filter(
        (s) => (draft[s.id] ?? s.remark).trim() !== s.remark
      ) ?? [],
    [data, draft]
  )
  const save = useMutation({
    mutationFn: () =>
      api<RemarksData>(url, {
        method: "PUT",
        body: {
          remarks: dirty.map((s) => ({
            userId: s.id,
            text: (draft[s.id] ?? "").trim(),
          })),
        },
      }),
    onSuccess: (next) => {
      client.setQueryData(key, next)
      void client.invalidateQueries({ queryKey: ["org", slug, "exam", examId] })
    },
  })
  useEffect(() => {
    if (dirty.length === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty.length])
  if (!data) return <Loading error={error} />
  const empty = data.students.filter((s) => !(draft[s.id] ?? "").trim()).length
  return (
    <>
      <div className="mb-1 text-body-sm text-muted-foreground">
        <Link
          href={orgPages(slug).manage(`/exams`)}
          className="hover:underline"
        >
          Exams
        </Link>{" "}
        ·{" "}
        <Link
          href={orgPages(slug).manage(`/exams/${examId}`)}
          className="hover:underline"
        >
          {data.exam.name}
        </Link>
      </div>
      <PageTitle
        action={
          data.canWrite && (
            <Button
              onClick={() => save.mutate()}
              disabled={dirty.length === 0 || save.isPending}
            >
              {dirty.length ? `Save ${dirty.length} remarks` : "Saved"}
            </Button>
          )
        }
      >
        Remarks · {data.class.name}
      </PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-muted-foreground">
        {data.classTeacher ? `Class teacher: ${data.classTeacher}. ` : ""}
        {data.exam.published
          ? "The results are published, so remarks are locked."
          : !data.canWrite
            ? "Only the class teacher can write these."
            : `${data.students.length - empty} of ${data.students.length} written. Pick from the comment bank or write your own; they show on the report card.`}
      </p>
      {save.error && (
        <FormMessage message={{ text: save.error.message, kind: "err" }} />
      )}
      {save.isSuccess && dirty.length === 0 && (
        <FormMessage message={{ text: "Remarks saved.", kind: "ok" }} />
      )}
      {data.students.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No students in this class that year</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3" data-testid="remarks">
          {data.students.map((s) => {
            const value = draft[s.id] ?? ""
            return (
              <Card key={s.id} size="sm" data-testid="remark-row">
                <CardHeader>
                  <CardTitle>
                    {s.rollNo != null && (
                      <span className="mr-2 text-muted-foreground tabular-nums">
                        {s.rollNo}
                      </span>
                    )}
                    {s.name}
                  </CardTitle>
                  <CardDescription>
                    {s.percent == null
                      ? "No marks yet"
                      : `${fmt(s.percent)}% · ${s.grade}`}
                    {s.rank != null && ` · rank ${s.rank}`}
                    {s.result !== "none" && (
                      <span className={cn("ml-1", RESULT[s.result]?.tone)}>
                        · {RESULT[s.result]?.label}
                      </span>
                    )}
                  </CardDescription>
                  {data.canWrite && data.bank.length > 0 && (
                    <CardAction>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={`Pick a remark for ${s.name}`}
                            />
                          }
                        >
                          Comment bank
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="max-w-sm">
                          {data.bank.map((b) => (
                            <DropdownMenuItem
                              key={b}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  [s.id]: [value.trim(), fill(b, s.name)]
                                    .filter(Boolean)
                                    .join(" "),
                                })
                              }
                            >
                              {fill(b, s.name)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent className="grid gap-2">
                  <TextArea
                    aria-label={`Remark for ${s.name}`}
                    maxLength={500}
                    disabled={!data.canWrite}
                    value={value}
                    placeholder={data.canWrite ? "Write a remark" : "No remark"}
                    onChange={(e) =>
                      setDraft({ ...draft, [s.id]: e.target.value })
                    }
                  />
                  {s.subjects.length > 0 && (
                    <ul className="grid gap-0.5 text-caption text-muted-foreground">
                      {s.subjects.map((r) => (
                        <li key={r.subject}>
                          <span className="font-medium">{r.subject}:</span>{" "}
                          {r.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
