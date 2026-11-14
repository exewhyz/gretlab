"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DEFAULT_FOOTER,
  renderEmail,
  templateProblem,
  type TemplateVar,
} from "@workspace/judge"
import { useMemo, useRef, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { sendTest } from "@/features/emails/server"

/*
 * Dashboard › Emails: the wording of every email the site sends, with a live preview that
 * renders exactly what will be sent (packages/judge/src/emails.ts), a test to yourself,
 * and a way back to the default. The footer is shared by every email.
 */

interface Template {
  key: string
  label: string
  description: string
  category: string
  subject: string
  body: string
  why: string | null
  defaults: { subject: string; body: string }
  vars: TemplateVar[]
  examples: Record<string, string>
  changed: boolean
}

interface Data {
  layout: { site: string; siteUrl: string }
  footer: {
    body: string
    default: string
    changed: boolean
    vars: TemplateVar[]
  }
  templates: Template[]
}

const FOOTER = "layout"

export function AdminEmails() {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["admin", "emails"],
    queryFn: () => api<Data>("/admin/emails"),
  })
  const [picked, setPicked] = useState<string>("account.confirm")
  if (!data) return <Loading error={error} />
  const categories = [...new Set(data.templates.map((t) => t.category))]
  return (
    <div className="grid gap-4" data-testid="admin-emails">
      <div>
        <PageTitle>Emails</PageTitle>
        <p className="-mt-2 max-w-3xl text-body-sm text-muted-foreground">
          The wording of every email {data.layout.site} sends. Changes apply to
          the next email sent. Each is sent as a branded email with a plain-text
          copy.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Emails" className="grid content-start gap-3">
          {categories.map((c) => (
            <div key={c} className="grid gap-1">
              <div className="px-2 text-caption font-semibold text-muted-foreground">
                {c}
              </div>
              {data.templates
                .filter((t) => t.category === c)
                .map((t) => (
                  <Item
                    key={t.key}
                    on={picked === t.key}
                    onClick={() => setPicked(t.key)}
                    changed={t.changed}
                  >
                    {t.label}
                  </Item>
                ))}
            </div>
          ))}
          <div className="grid gap-1">
            <div className="px-2 text-caption font-semibold text-muted-foreground">
              Every email
            </div>
            <Item
              on={picked === FOOTER}
              onClick={() => setPicked(FOOTER)}
              changed={data.footer.changed}
            >
              Footer
            </Item>
          </div>
        </nav>
        <Editor
          key={picked}
          data={data}
          pick={picked}
          onSaved={(next) => client.setQueryData(["admin", "emails"], next)}
        />
      </div>
    </div>
  )
}

function Item({
  on,
  changed,
  onClick,
  children,
}: {
  on: boolean
  changed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-body-sm",
        on ? "bg-muted font-medium text-ink" : "text-body hover:bg-muted/60"
      )}
    >
      {children}
      {changed && (
        <Badge variant="secondary" className="text-[10px]">
          Edited
        </Badge>
      )}
    </button>
  )
}

function Editor({
  data,
  pick,
  onSaved,
}: {
  data: Data
  pick: string
  onSaved: (d: Data) => void
}) {
  const footer = pick === FOOTER
  const t = data.templates.find((x) => x.key === pick)
  const [subject, setSubject] = useState(footer ? "" : (t?.subject ?? ""))
  const [body, setBody] = useState(footer ? data.footer.body : (t?.body ?? ""))
  const [view, setView] = useState<"html" | "text">("html")
  const [note, setNote] = useState<{ text: string; kind: "ok" | "err" } | null>(
    null
  )
  const area = useRef<HTMLTextAreaElement>(null)
  const vars = footer ? data.footer.vars : (t?.vars ?? [])
  const problem = templateProblem(
    footer ? "layout" : (pick as never),
    subject,
    body
  )
  const dirty = footer
    ? body !== data.footer.body
    : subject !== t?.subject || body !== t?.body
  const preview = useMemo(() => {
    // The footer is shown under a sample notification.
    const sample = data.templates.find((x) => x.key === "notification")!
    const wording = footer
      ? {
          subject: sample.subject,
          body: sample.body,
          why: sample.why ?? undefined,
        }
      : { subject, body, why: t?.why ?? undefined }
    const values = footer ? sample.examples : (t?.examples ?? {})
    return renderEmail(wording, values, {
      ...data.layout,
      footer: footer ? body : data.footer.body,
    })
  }, [data, footer, subject, body, t])
  const save = useMutation({
    mutationFn: () =>
      api<Data>(`/admin/emails/${pick}`, {
        method: "PUT",
        body: { subject, body },
      }),
    onSuccess: (next) => {
      onSaved(next)
      setNote({ text: "Saved. The next email sent uses it.", kind: "ok" })
    },
    onError: (e) => setNote({ text: e.message, kind: "err" }),
  })
  const reset = useMutation({
    mutationFn: () => api<Data>(`/admin/emails/${pick}`, { method: "DELETE" }),
    onSuccess: (next) => {
      onSaved(next)
      if (footer) setBody(next.footer.body)
      else {
        const fresh = next.templates.find((x) => x.key === pick)!
        setSubject(fresh.subject)
        setBody(fresh.body)
      }
      setNote({ text: "Back to the default.", kind: "ok" })
    },
  })
  const test = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof sendTest>>(`/admin/emails/${pick}/test`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (r) =>
      setNote({
        text: `A test went to ${r.to}, with example values.`,
        kind: "ok",
      }),
    onError: (e) => setNote({ text: e.message, kind: "err" }),
  })
  /** Puts a placeholder where the cursor is. */
  const insert = (key: string) => {
    const el = area.current
    const token = `{{${key}}}`
    if (!el) return setBody((b) => b + token)
    const [a, b] = [el.selectionStart, el.selectionEnd]
    setBody(body.slice(0, a) + token + body.slice(b))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + token.length, a + token.length)
    })
  }
  const changed = footer ? data.footer.changed : t?.changed
  return (
    <div
      className="grid min-w-0 gap-4 xl:grid-cols-2"
      data-testid="email-editor"
    >
      <Card className="grid content-start gap-3">
        <div>
          <h2 className="text-title-md font-semibold text-ink">
            {footer ? "Footer" : t?.label}
          </h2>
          <p className="text-caption">
            {footer ? "Under every email the site sends." : t?.description}
          </p>
        </div>
        {!footer && (
          <Field label="Subject">
            <TextInput
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
        )}
        <Field label={footer ? "Footer text" : "Body"}>
          <TextArea
            ref={area}
            rows={footer ? 3 : 12}
            className="font-mono text-xs"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <div className="grid gap-1.5">
          <span className="text-caption font-semibold text-ink">
            Placeholders (click to add)
          </span>
          <div className="flex flex-wrap gap-1.5">
            {vars.map((v) => (
              <button
                key={v.key}
                type="button"
                title={`${v.description}${v.required ? " (must stay)" : ""}. For example: ${v.example}`}
                onClick={() => insert(v.key)}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 font-mono text-xs",
                  v.required
                    ? "border-primary/40 bg-primary/5 text-primary-active"
                    : "border-hairline bg-muted text-ink"
                )}
              >
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
        </div>
        <details className="text-caption">
          <summary className="cursor-pointer text-ink">How to format</summary>
          <ul className="mt-1 grid list-disc gap-0.5 pl-5">
            <li>
              <code>**words**</code> bold, <code>[words](link)</code> a link
            </li>
            <li>
              <code>[button: words](link)</code> on its own line: a button
            </li>
            <li>
              <code>- item</code> lines: a list. A blank line starts a new
              paragraph.
            </li>
            <li>
              What people wrote (a notice&apos;s text) is never read as
              formatting.
            </li>
          </ul>
        </details>
        {problem && <FormMessage message={{ text: problem, kind: "err" }} />}
        {note && <FormMessage message={note} />}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!dirty || Boolean(problem) || save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
          <Button
            variant="outline"
            disabled={test.isPending || dirty}
            onClick={() => test.mutate()}
            title={dirty ? "Save first" : undefined}
          >
            Send me a test
          </Button>
          {changed && (
            <ConfirmButton
              variant="ghost"
              title="Go back to the default wording?"
              description="Your changes to this email are dropped."
              confirmLabel="Use the default"
              onConfirm={() => reset.mutate()}
            >
              Reset to default
            </ConfirmButton>
          )}
          {!changed && dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setSubject(footer ? "" : (t?.subject ?? ""))
                setBody(
                  footer
                    ? (data.footer.body ?? DEFAULT_FOOTER)
                    : (t?.body ?? "")
                )
              }}
            >
              Undo
            </Button>
          )}
        </div>
      </Card>
      <Card className="grid min-w-0 content-start gap-3 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <div className="min-w-0">
            <div className="text-caption">Preview, with example values</div>
            <div
              className="truncate font-medium text-ink"
              data-testid="preview-subject"
            >
              {preview.subject}
            </div>
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Preview">
            {(["html", "text"] as const).map((v) => (
              <Button
                key={v}
                size="xs"
                role="tab"
                aria-selected={view === v}
                variant={view === v ? "default" : "outline"}
                onClick={() => setView(v)}
              >
                {v === "html" ? "Email" : "Plain text"}
              </Button>
            ))}
          </div>
        </div>
        {view === "html" ? (
          <iframe
            title="Email preview"
            data-testid="preview-html"
            sandbox=""
            srcDoc={preview.html}
            className="h-[560px] w-full rounded-b-xl border-t border-hairline bg-[#f7f7f4]"
          />
        ) : (
          <pre
            data-testid="preview-text"
            className="h-[560px] overflow-auto border-t border-hairline px-5 py-4 text-xs whitespace-pre-wrap text-ink"
          >
            {preview.text}
          </pre>
        )}
      </Card>
    </div>
  )
}
