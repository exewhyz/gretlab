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
import { RESULT, fmt } from "./results-parts"

export interface RemarksData {
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

export const fill = (template: string, name: string) =>
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
