"use client"

import { CheckCircleIcon } from "@phosphor-icons/react"
import { useState, type FormEvent, type ReactElement } from "react"

import { Button } from "@workspace/ui/components/button"

import { Field, SelectInput, TextArea, TextInput } from "@/components/form"
import { api, ApiRequestError } from "@/lib/api/client"

import { ENQUIRY_KINDS, enquirySchema, LEARNER_SIZES, type EnquiryInput } from "../schemas"

/*
 * "Talk to us": a short form for a college, university, coaching institute, cohort program or school. Checked here with the
 * same rules as the server, sent to POST /enquiries, and answered with what happens next.
 * A hidden field catches bots.
 */

type Errors = Partial<Record<keyof EnquiryInput, string>>

const EMPTY: EnquiryInput = { name: "", email: "", organization: "", kind: "college", learners: "100–500", message: "", website: "" }

export function ContactForm() {
  const [form, setForm] = useState<EnquiryInput>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<{ name: string; email: string } | null>(null)

  const set = <K extends keyof EnquiryInput>(key: K, value: EnquiryInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    const checked = enquirySchema.safeParse(form)
    if (!checked.success) {
      const next: Errors = {}
      for (const issue of checked.error.issues) {
        const key = issue.path[0] as keyof EnquiryInput
        next[key] ??= issue.message
      }
      setErrors(next)
      return
    }
    setSending(true)
    try {
      await api("/enquiries", { body: checked.data })
      setSent({ name: checked.data.name.split(" ")[0] ?? checked.data.name, email: checked.data.email })
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error.message : "That didn't send. Please try again.")
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div role="status" className="rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-8">
        <CheckCircleIcon aria-hidden weight="fill" className="size-8 text-success" />
        <p className="mt-3 text-title-md text-ink">Thanks, {sent.name}. We've got it.</p>
        <p className="mt-2 max-w-[48ch] text-body-sm text-body">
          We'll write back to <span className="text-ink">{sent.email}</span>.
        </p>
      </div>
    )
  }

  return (
    <form noValidate onSubmit={submit} className="rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled label="Your name" error={errors.name}>
          <TextInput autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />
        </Labelled>
        <Labelled label="Work email" error={errors.email}>
          <TextInput type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!errors.email} />
        </Labelled>
        <div className="sm:col-span-2">
          <Labelled label="College, program or school" error={errors.organization}>
            <TextInput autoComplete="organization" value={form.organization} onChange={(e) => set("organization", e.target.value)} aria-invalid={!!errors.organization} />
          </Labelled>
        </div>
        <Labelled label="What kind" error={errors.kind}>
          <SelectInput value={form.kind} onChange={(e) => set("kind", e.target.value as EnquiryInput["kind"])}>
            {ENQUIRY_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </SelectInput>
        </Labelled>
        <Labelled label="Learners" error={errors.learners}>
          <SelectInput value={form.learners} onChange={(e) => set("learners", e.target.value as EnquiryInput["learners"])}>
            {LEARNER_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectInput>
        </Labelled>
        <div className="sm:col-span-2">
          <Labelled label="Anything we should know (optional)" error={errors.message}>
            <TextArea rows={3} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="Your college or institute, how many students, and what you'd like to run on GretLab" />
          </Labelled>
        </div>
        {/* People never see this; bots fill it in. */}
        <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
          <TextInput tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} name="website" />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={sending} className="transition-[color,background-color,transform] duration-150 active:scale-[0.98]">
          {sending ? "Sending…" : "Talk to us"}
        </Button>
        <p className="text-caption text-muted-foreground">We reply by email, and add you to no lists.</p>
      </div>
      {failure && (
        <p role="alert" className="mt-4 text-body-sm text-destructive">
          {failure}
        </p>
      )}
    </form>
  )
}

function Labelled({ label, error, children }: { label: string; error?: string; children: ReactElement<{ id?: string }> }) {
  return (
    <div className="grid gap-1">
      <Field label={label}>{children}</Field>
      {error && <p className="text-caption text-destructive">{error}</p>}
    </div>
  )
}
