"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import type { getApplication } from "@/features/admissions/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"
import { STATUS, shortDate } from "./admissions-parts"

export type Application = ApiResult<typeof getApplication>

/** One application: its details, and moving it on or admitting. */
export function ApplicationPage({ slug, id }: { slug: string; id: string }) {
  const client = useQueryClient()
  const router = useRouter()
  const key = ["org", slug, "admission", id]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Application>(`/orgs/${slug}/admissions/${id}`),
  })
  const [moving, setMoving] = useState<
    "reviewing" | "waitlisted" | "rejected" | null
  >(null)
  const [admitting, setAdmitting] = useState(false)
  if (!data) return <Loading error={error} />
  const open = data.admit !== null
  const rows: [string, string | null][] = [
    [
      "Applying for",
      data.grade ? `${data.grade.name}, ${data.year?.name ?? ""}` : null,
    ],
    ["Date of birth", data.birthDate],
    ["Gender", data.gender || null],
    ["Previous school", data.previousSchool || null],
    [
      data.relation === "self"
        ? "Applicant"
        : `Parent (${data.relation || "guardian"})`,
      data.parentName,
    ],
    ["Signed in as", data.applicant.email],
    ["Phone", data.phone],
    ["Address", data.address],
    ["Notes", data.notes || null],
  ]
  return (
    <>
      <div className="mb-1 text-body-sm text-muted-foreground">
        <Link
          href={orgPages(slug).manage(`/admissions`)}
          className="hover:underline"
        >
          Admissions
        </Link>{" "}
        · {data.number}
      </div>
      <PageTitle
        action={
          open && (
            <div className="flex flex-wrap gap-2">
              {data.status === "submitted" && (
                <Button
                  variant="outline"
                  onClick={() => setMoving("reviewing")}
                >
                  Start review
                </Button>
              )}
              {data.status !== "waitlisted" && (
                <Button
                  variant="outline"
                  onClick={() => setMoving("waitlisted")}
                >
                  Waitlist
                </Button>
              )}
              <Button variant="outline" onClick={() => setMoving("rejected")}>
                Don&apos;t admit
              </Button>
              <Button onClick={() => setAdmitting(true)}>Admit</Button>
            </div>
          )
        }
      >
        <span className="mr-2">{data.studentName}</span>
        <Badge
          variant={STATUS[data.status].variant}
          data-testid="application-status"
        >
          {STATUS[data.status].label}
        </Badge>
      </PageTitle>
      {data.decidedBy && (
        <p className="mb-3 text-body-sm text-muted-foreground">
          {STATUS[data.status].label} by {data.decidedBy}
          {data.decidedAt && ` on ${shortDate(data.decidedAt)}`}
          {data.message && `: “${data.message}”`}
        </p>
      )}
      {data.student && (
        <p className="mb-3 text-body-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href={orgPages(slug).manage(`/students/${data.student.id}`)}
          >
            Open the student&apos;s record ›
          </Link>
        </p>
      )}
      <Card className="max-w-3xl">
        <CardContent>
          <dl
            className="grid gap-x-6 gap-y-3 sm:grid-cols-2"
            data-testid="application-details"
          >
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div
                  key={k}
                  className={
                    k === "Address" || k === "Notes" ? "sm:col-span-2" : ""
                  }
                >
                  <dt className="text-caption text-muted-foreground">{k}</dt>
                  <dd className="text-body-sm whitespace-pre-line text-ink">
                    {v}
                  </dd>
                </div>
              ))}
          </dl>
        </CardContent>
      </Card>
      {moving && (
        <MoveDialog
          slug={slug}
          id={id}
          to={moving}
          name={data.studentName}
          onDone={(changed) => (
            setMoving(null),
            changed &&
              void client.invalidateQueries({ queryKey: ["org", slug] })
          )}
        />
      )}
      {admitting && data.admit && (
        <AdmitDialog
          slug={slug}
          app={data}
          onDone={(studentId) => {
            setAdmitting(false)
            if (studentId) {
              void client.invalidateQueries({ queryKey: ["org", slug] })
              router.refresh()
            }
          }}
        />
      )}
    </>
  )
}

export function MoveDialog({
  slug,
  id,
  to,
  name,
  onDone,
}: {
  slug: string
  id: string
  to: "reviewing" | "waitlisted" | "rejected"
  name: string
  onDone: (changed: boolean) => void
}) {
  const [message, setMessage] = useState("")
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/admissions/${id}/status`, {
        body: { status: to, message },
      }),
    onSuccess: () => onDone(true),
  })
  const title = {
    reviewing: "Start reviewing",
    waitlisted: "Put on the waiting list",
    rejected: "Don't admit",
  }[to]
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title}: {name}
          </DialogTitle>
          <DialogDescription>
            The applicant is told, with your message.
          </DialogDescription>
        </DialogHeader>
        <Field label="Message to the applicant (optional)">
          <TextArea
            maxLength={500}
            value={message}
            placeholder={
              to === "reviewing"
                ? "Please bring the birth certificate for an interview on…"
                : ""
            }
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button
            variant={to === "rejected" ? "destructive" : "default"}
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdmitDialog({
  slug,
  app,
  onDone,
}: {
  slug: string
  app: Application
  onDone: (studentId: string | null) => void
}) {
  const admit = app.admit!
  const [form, setForm] = useState({
    groupId: admit.sections.length === 1 ? admit.sections[0]!.id : "",
    rollNo: "",
    admissionNo: admit.admissionNo,
    email: "",
    message: "",
  })
  const save = useMutation({
    mutationFn: () =>
      api<{ studentId: string; admissionNo: string }>(
        `/orgs/${slug}/admissions/${app.id}/admit`,
        {
          body: { ...form, rollNo: form.rollNo ? Number(form.rollNo) : null },
        }
      ),
    onSuccess: (r) => onDone(r.studentId),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Admit {app.studentName}</DialogTitle>
          <DialogDescription>
            Creates their student record and enrols them in {app.year?.name}
            {app.year &&
              !app.year.isCurrent &&
              " (they join their class when that year becomes current)"}
            {admit.linksParent &&
              `, and links ${app.parentName}'s account as their parent`}
            .
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Section">
              <SelectInput
                value={form.groupId}
                onChange={(e) => setForm({ ...form, groupId: e.target.value })}
              >
                <option value="">Choose</option>
                {admit.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Roll number (optional)">
              <TextInput
                type="number"
                min={1}
                value={form.rollNo}
                onChange={(e) => setForm({ ...form, rollNo: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Admission number">
            <TextInput
              value={form.admissionNo}
              onChange={(e) =>
                setForm({ ...form, admissionNo: e.target.value })
              }
            />
          </Field>
          {app.relation !== "self" && (
            <Field
              label="Student's own email (optional)"
              help="For older students who sign in themselves. Leave blank for young children."
            >
              <TextInput
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          )}
          <Field label="Message to the applicant (optional)">
            <TextArea
              maxLength={500}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </Field>
        </div>
        {admit.sections.length === 0 && (
          <p className="text-caption text-destructive">
            That class has no sections. Add one in Classes first.
          </p>
        )}
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={!form.groupId || save.isPending}
          >
            Admit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
