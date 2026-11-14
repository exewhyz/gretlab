"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"

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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { ConfirmDialog } from "@/components/confirm"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import type { admissionForm } from "@/features/admissions/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"
import { STATUS, shortDate } from "./admissions-parts"

export type Form = ApiResult<typeof admissionForm>

/** /orgs/[slug]/apply: the admission form and your applications. */
export function ApplyPage({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "admission-form"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Form>(`/orgs/${slug}/admissions/form`),
  })
  const [form, setForm] = useState({
    gradeId: "",
    studentName: "",
    birthDate: "",
    gender: "",
    previousSchool: "",
    parentName: "",
    relation: "mother",
    phone: "",
    address: "",
    notes: "",
  })
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  useEffect(() => {
    if (data && !form.parentName && data.applicant.name)
      setForm((f) => ({ ...f, parentName: data.applicant.name }))
  }, [data, form.parentName])
  const send = useMutation({
    mutationFn: () => api(`/orgs/${slug}/admissions`, { body: form }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key })
      setForm((f) => ({
        ...f,
        studentName: "",
        birthDate: "",
        gender: "",
        previousSchool: "",
        notes: "",
      }))
    },
  })
  const withdraw = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/admissions/${id}/withdraw`, { body: {} }),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
  })
  if (!data) return <Loading error={error} />
  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch })
    send.reset()
  }
  const self = form.relation === "self"
  return (
    <div className="grid gap-6">
      <div>
        <div className="text-body-sm text-muted-foreground">
          {data.org.name}
        </div>
        <h1 className="text-display-sm text-ink">Apply for admission</h1>
        {data.year && (
          <p className="text-body-sm text-muted-foreground">
            For the academic year {data.year.name}.
          </p>
        )}
      </div>
      {data.mine.length > 0 && (
        <section className="grid gap-2" data-testid="my-applications">
          <h2 className="text-title-sm text-ink">Your applications</h2>
          {data.mine.map((a) => (
            <Card key={a.id} size="sm" data-testid="my-application">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {a.studentName}
                  <Badge variant={STATUS[a.status].variant}>
                    {STATUS[a.status].label}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {a.number}
                  {a.grade && ` · ${a.grade}`} · sent {shortDate(a.createdAt)}
                  {a.message && (
                    <span className="mt-1 block text-ink">“{a.message}”</span>
                  )}
                </CardDescription>
                {a.canWithdraw && (
                  <CardAction>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setWithdrawing(a.id)}
                    >
                      Withdraw
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
            </Card>
          ))}
        </section>
      )}
      {!data.open ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>
              {data.org.name} isn&apos;t taking applications now
            </EmptyTitle>
            <EmptyDescription>
              Check back later, or contact the school.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>New application</CardTitle>
            {data.instructions && (
              <CardDescription
                className="whitespace-pre-line"
                data-testid="admission-instructions"
              >
                {data.instructions}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(e) => (e.preventDefault(), send.mutate())}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Applying for">
                  <SelectInput
                    value={form.gradeId}
                    onChange={(e) => set({ gradeId: e.target.value })}
                  >
                    <option value="">Choose a class</option>
                    {data.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="You are the student's">
                  <SelectInput
                    value={form.relation}
                    onChange={(e) => set({ relation: e.target.value })}
                  >
                    <option value="mother">Mother</option>
                    <option value="father">Father</option>
                    <option value="guardian">Guardian</option>
                    <option value="self">I am the student</option>
                  </SelectInput>
                </Field>
              </div>
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-caption font-semibold text-muted-foreground">
                  The student
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Student's full name">
                    <TextInput
                      value={form.studentName}
                      onChange={(e) => set({ studentName: e.target.value })}
                    />
                  </Field>
                  <Field label="Date of birth">
                    <TextInput
                      type="date"
                      value={form.birthDate}
                      onChange={(e) => set({ birthDate: e.target.value })}
                    />
                  </Field>
                  <Field label="Gender">
                    <SelectInput
                      value={form.gender}
                      onChange={(e) => set({ gender: e.target.value })}
                    >
                      <option value="">Prefer not to say</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="other">Other</option>
                    </SelectInput>
                  </Field>
                  <Field label="Previous school (if any)">
                    <TextInput
                      value={form.previousSchool}
                      onChange={(e) => set({ previousSchool: e.target.value })}
                    />
                  </Field>
                </div>
              </fieldset>
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-caption font-semibold text-muted-foreground">
                  {self ? "You" : "Parent or guardian"}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={self ? "Your name" : "Parent's name"}>
                    <TextInput
                      value={form.parentName}
                      onChange={(e) => set({ parentName: e.target.value })}
                    />
                  </Field>
                  <Field label="Phone">
                    <TextInput
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set({ phone: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Address">
                  <TextArea
                    value={form.address}
                    maxLength={300}
                    onChange={(e) => set({ address: e.target.value })}
                  />
                </Field>
                <Field label="Anything else the school should know">
                  <TextArea
                    value={form.notes}
                    maxLength={1000}
                    onChange={(e) => set({ notes: e.target.value })}
                  />
                </Field>
              </fieldset>
              <p className="text-caption text-muted-foreground">
                We&apos;ll reply to {data.applicant.email}. Birth date, phone
                and address are stored encrypted and seen only by the admissions
                office.
              </p>
              {send.error && (
                <FormMessage
                  message={{ text: send.error.message, kind: "err" }}
                />
              )}
              {send.isSuccess && (
                <FormMessage
                  message={{
                    text: "Application sent. You'll hear from the school here and by email.",
                    kind: "ok",
                  }}
                />
              )}
              <div>
                <Button type="submit" disabled={send.isPending}>
                  Send application
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {withdrawing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setWithdrawing(null)}
          title="Withdraw this application?"
          description="The school stops considering it. You can apply again later."
          confirmLabel="Withdraw"
          onConfirm={() => withdraw.mutate(withdrawing)}
        />
      )}
    </div>
  )
}

/** The Apply button on a school's public page. */
export function ApplyButton({ slug }: { slug: string }) {
  return (
    <Link
      href={orgPages(slug).apply}
      className={buttonVariants()}
      data-testid="apply-button"
    >
      Apply for admission
    </Link>
  )
}
