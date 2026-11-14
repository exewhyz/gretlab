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

import { Exams } from "./exams-list"
import { fmt } from "./results-parts"

export interface Sheet {
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

export const markError = (text: string, max: number) => {
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
                <TableHead>Remark</TableHead>
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
                    <TableCell>
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
