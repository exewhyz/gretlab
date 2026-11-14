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

import { ExamDialog, Exams } from "./exams-list"
import { Paper, RESULT, fmt } from "./results-parts"

export type ExamDetail = ApiResult<typeof getExam>

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

export function PapersDialog({
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

export function PaperDialog({
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

export type ResultsData = ApiResult<typeof examResults>

export function ClassResults({
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
