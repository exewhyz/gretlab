"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { MODULES, type ModuleKey } from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Switch } from "@workspace/ui/components/switch"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"

import { ORG_TYPE } from "./public"

import { useSummary, type Message, type Summary } from "./manage-shared"

export function ManageSettings({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const { data, error } = useSummary(slug)
  if (!data) return <Loading error={error} />
  return (
    <SettingsForm
      key={JSON.stringify(data.org)}
      slug={slug}
      initial={data.org}
      onSaved={() =>
        void queryClient.invalidateQueries({ queryKey: ["org", slug] })
      }
    />
  )
}

export function SettingsForm({
  slug,
  initial,
  onSaved,
}: {
  slug: string
  initial: Summary["org"]
  onSaved: () => void
}) {
  const { data: viewer } = useViewer()
  const [form, setForm] = useState({
    ...initial,
    emailDomains: initial.emailDomains.join(", "),
    groupLevels: initial.groupLevels.join(", "),
  })
  const [message, setMessage] = useState<Message>(null)
  const split = (text: string) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}`, {
        method: "PATCH",
        body: {
          name: form.name,
          description: form.description,
          website: form.website,
          listed: form.listed,
          joinPolicy: form.joinPolicy,
          emailDomains: split(form.emailDomains),
          groupLevels: split(form.groupLevels),
          languages: form.languages,
          allowPaste: form.allowPaste,
        },
      }),
    onSuccess: () => {
      setMessage({ text: "Saved.", kind: "ok" })
      onSaved()
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const set = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K]
  ) => {
    setForm({ ...form, [key]: value })
    setMessage(null)
  }
  return (
    <>
      <PageTitle>Settings</PageTitle>
      <Card className="grid gap-4">
        <div className="grid gap-3 min-[901px]:grid-cols-2">
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field
            label="Kind"
            help="Chosen when it was created, and can't be changed: its structure, words and modules depend on it."
          >
            <TextInput
              readOnly
              aria-readonly="true"
              value={initial.kind?.label ?? ORG_TYPE[form.type]}
              className="bg-muted"
              data-testid="org-kind"
            />
          </Field>
        </div>
        <Field label="About" help="Shown on the organization's page.">
          <TextArea
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <Field label="Website">
          <TextInput
            value={form.website}
            placeholder="https://"
            onChange={(e) => set("website", e.target.value)}
          />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-caption font-semibold text-ink">
            Who can join
          </legend>
          <RadioGroup
            value={form.joinPolicy}
            onValueChange={(value) =>
              set("joinPolicy", value as typeof form.joinPolicy)
            }
            className="grid gap-2"
          >
            {(
              [
                ["open", "Anyone, at once"],
                [
                  "approval",
                  "Anyone can ask; someone with Invite and approve lets them in",
                ],
                ["invite", "Only people with an invite link"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex items-center gap-2 text-body-sm text-ink"
              >
                <RadioGroupItem value={value} aria-label={label} />
                {label}
              </label>
            ))}
          </RadioGroup>
        </fieldset>
        <Field
          label="Email domains that join at once"
          help="Comma separated, e.g. cumail.in. People with these addresses skip approval."
        >
          <TextInput
            value={form.emailDomains}
            onChange={(e) => set("emailDomains", e.target.value)}
          />
        </Field>
        <Field
          label="Group levels"
          help="Top first, comma separated: Branch, Batch for a college; Team for a company."
        >
          <TextInput
            value={form.groupLevels}
            onChange={(e) => set("groupLevels", e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-body-sm text-ink">
          <Checkbox
            checked={form.listed}
            onCheckedChange={(checked) => set("listed", checked)}
          />
          Show in the public directory
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-caption font-semibold text-ink">
            Languages in our contests and members-only problems
          </legend>
          <label className="flex items-center gap-2 text-body-sm text-ink">
            <Checkbox
              checked={form.languages === null}
              onCheckedChange={(checked) =>
                set(
                  "languages",
                  checked ? null : (viewer?.languages.map((l) => l.id) ?? [])
                )
              }
            />
            Any language the platform offers
          </label>
          {form.languages !== null && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
              {viewer?.languages.map((l) => (
                <label
                  key={l.id}
                  className="flex items-center gap-1.5 text-body-sm text-ink"
                >
                  <Checkbox
                    checked={form.languages!.includes(l.id)}
                    onCheckedChange={(checked) =>
                      set(
                        "languages",
                        checked
                          ? [...form.languages!, l.id]
                          : form.languages!.filter((x) => x !== l.id)
                      )
                    }
                  />
                  {l.label}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <label className="flex items-start gap-2 text-body-sm text-ink">
          <Checkbox
            checked={form.allowPaste}
            onCheckedChange={(checked) => set("allowPaste", checked)}
          />
          <span>
            Allow pasting code in our contests
            <span className="block text-xs text-body">
              Turned off, the editor undoes pastes. It discourages copying; it
              can&apos;t stop someone determined.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-3 border-t border-hairline pt-3">
          <span className="flex-1">
            <FormMessage message={message} />
          </span>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save settings
          </Button>
        </div>
      </Card>
      {initial.execution && (
        <ExecutionCard
          slug={slug}
          execution={initial.execution}
          onSaved={onSaved}
        />
      )}
      {initial.limits && (
        <LimitsCard slug={slug} limits={initial.limits} onSaved={onSaved} />
      )}
      {initial.twoFactor && (
        <TwoFactorCard
          slug={slug}
          twoFactor={initial.twoFactor}
          onSaved={onSaved}
        />
      )}
      <ModulesCard slug={slug} org={initial} onSaved={onSaved} />
    </>
  )
}

/**
 * Where the organization's code runs: it can turn server execution off for its own work
 * (when the judge is failing) and allow grading in the browser, never more than the
 * platform allows.
 */
function ExecutionCard({
  slug,
  execution,
  onSaved,
}: {
  slug: string
  execution: NonNullable<Summary["org"]["execution"]>
  onSaved: () => void
}) {
  const [server, setServer] = useState(execution.server)
  const [browserGrading, setBrowserGrading] = useState(execution.browserGrading)
  const [message, setMessage] = useState<Message>(null)
  const { platform } = execution
  const gradingAllowed = platform.browser && platform.browserGrading
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}`, {
        method: "PATCH",
        body: { execution: { server, browserGrading } },
      }),
    // Saving reloads the settings, which rebuilds this card, so success is a toast.
    onSuccess: onSaved,
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
    meta: { success: "Code execution saved.", quiet: true },
  })
  return (
    <Card className="grid gap-3" data-testid="execution-card">
      <div>
        <h2 className="text-title-sm text-ink">Code execution</h2>
        <p className="text-body-sm text-body">
          Where your assignments, contests and members-only problems run code.
          You can only narrow what the platform allows.
        </p>
      </div>
      <label className="flex items-start gap-2 text-body-sm text-ink">
        <Switch
          checked={server && platform.server}
          disabled={!platform.server}
          onCheckedChange={(checked) => {
            setServer(checked)
            setMessage(null)
          }}
          aria-label="Run code on the server"
        />
        <span>
          Run code on the server
          <span className="block text-xs text-body">
            {platform.server
              ? "Every language, graded in the sandbox. Turn it off if the judge is failing; students then run Python and JavaScript in their browser."
              : "Server execution is off for the whole site, so it can't be turned on here."}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-body-sm text-ink">
        <Switch
          checked={browserGrading && gradingAllowed}
          disabled={!gradingAllowed}
          onCheckedChange={(checked) => {
            setBrowserGrading(checked)
            setMessage(null)
          }}
          aria-label="Allow grading in the browser"
        />
        <span>
          Allow grading in the browser
          <span className="block text-xs text-body">
            {gradingAllowed
              ? "Lets assignments and contests choose \"In the students' browsers\" (Python and JavaScript), and lets members-only practice be submitted while the server is off. Every test's input reaches the student's browser; the server checks the outputs, and results are provisional until the server judges them again."
              : "Grading in the browser is off for the whole site."}
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3 border-t border-hairline pt-3">
        <span className="flex-1">
          <FormMessage message={message} />
        </span>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  )
}

/**
 * Time and memory per language for the organization's own work: blank keeps the platform's
 * default, and nothing may pass the platform's ceiling. A problem's own limit still wins.
 */
function LimitsCard({
  slug,
  limits,
  onSaved,
}: {
  slug: string
  limits: NonNullable<Summary["org"]["limits"]>
  onSaved: () => void
}) {
  // Seconds and megabytes as typed; blank means the platform's default.
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(
      limits.languages.map((l) => {
        const own = limits.values[l.id]
        return [
          l.id,
          {
            time: own?.timeLimitMs ? String(own.timeLimitMs / 1000) : "",
            memory: own?.memoryLimitMb ? String(own.memoryLimitMb) : "",
          },
        ]
      })
    )
  )
  const [message, setMessage] = useState<Message>(null)
  const edit = (id: string, field: "time" | "memory", value: string) => {
    setDraft({ ...draft, [id]: { ...draft[id]!, [field]: value } })
    setMessage(null)
  }
  const save = useMutation({
    mutationFn: () => {
      const body: Record<
        string,
        { timeLimitMs?: number; memoryLimitMb?: number }
      > = {}
      for (const [id, { time, memory }] of Object.entries(draft)) {
        const limit: { timeLimitMs?: number; memoryLimitMb?: number } = {}
        if (time.trim()) limit.timeLimitMs = Math.round(Number(time) * 1000)
        if (memory.trim()) limit.memoryLimitMb = Math.round(Number(memory))
        if (Object.keys(limit).length) body[id] = limit
      }
      return api(`/orgs/${slug}`, { method: "PATCH", body: { limits: body } })
    },
    // Saving reloads the settings, which rebuilds this card, so success is a toast.
    onSuccess: onSaved,
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
    meta: { success: "Time and memory limits saved.", quiet: true },
  })
  const { ceiling } = limits
  return (
    <Card className="grid gap-3" data-testid="limits-card">
      <div>
        <h2 className="text-title-sm text-ink">Time and memory</h2>
        <p className="text-body-sm text-body">
          How long and how much memory each run of your assignments, contests
          and members-only problems may use, per language. Leave a box empty for
          the platform&apos;s default; at most {ceiling.timeMs / 1000} s and{" "}
          {ceiling.memoryMb} MB. A problem with its own limits keeps them.
        </p>
      </div>
      <Table headers={["Language", "Time (seconds)", "Memory (MB)"]}>
        {limits.languages.map((l) => (
          <tr key={l.id}>
            <td>{l.label}</td>
            <td>
              <TextInput
                type="number"
                inputMode="decimal"
                min={0.1}
                max={ceiling.timeMs / 1000}
                step={0.1}
                className="w-32"
                aria-label={`${l.label} time limit in seconds`}
                placeholder={`${l.timeLimitMs / 1000} (default)`}
                value={draft[l.id]?.time ?? ""}
                onChange={(e) => edit(l.id, "time", e.target.value)}
              />
            </td>
            <td>
              <TextInput
                type="number"
                inputMode="numeric"
                min={32}
                max={ceiling.memoryMb}
                step={1}
                className="w-36"
                aria-label={`${l.label} memory limit in MB`}
                placeholder={`${l.memoryLimitMb} (default)`}
                value={draft[l.id]?.memory ?? ""}
                onChange={(e) => edit(l.id, "memory", e.target.value)}
              />
            </td>
          </tr>
        ))}
      </Table>
      <div className="flex items-center gap-3 border-t border-hairline pt-3">
        <span className="flex-1">
          <FormMessage message={message} />
        </span>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save limits
        </Button>
      </div>
    </Card>
  )
}

/**
 * Two-factor sign-in the organization requires of its people (features/auth/two-factor.ts).
 * It only adds to what the platform requires.
 */
function TwoFactorCard({
  slug,
  twoFactor,
  onSaved,
}: {
  slug: string
  twoFactor: NonNullable<Summary["org"]["twoFactor"]>
  onSaved: () => void
}) {
  const [required, setRequired] = useState(twoFactor.required)
  const [message, setMessage] = useState<Message>(null)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}`, {
        method: "PATCH",
        body: { requireTwoFactor: required },
      }),
    // Saving reloads the settings, which rebuilds this card, so success is a toast.
    onSuccess: onSaved,
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
    meta: { success: "Two-factor sign-in saved.", quiet: true },
  })
  const platform =
    twoFactor.platform === "everyone"
      ? "GretLab already requires it of everyone."
      : twoFactor.platform === "staff"
        ? "GretLab already requires it of staff."
        : null
  return (
    <Card className="grid gap-3" data-testid="two-factor-card">
      <div>
        <h2 className="text-title-sm text-ink">Two-factor sign-in</h2>
        <p className="text-body-sm text-body">
          Require a second step (an authenticator app, an emailed code or a
          passkey) when your people sign in. Those who haven&apos;t turned it on
          can only reach their security page until they do.
          {platform && ` ${platform}`}
        </p>
      </div>
      <RadioGroup
        value={required}
        onValueChange={(value) => {
          setRequired(value as typeof required)
          setMessage(null)
        }}
        className="grid gap-2"
      >
        {(
          [
            ["off", "Not required here"],
            ["staff", "Staff: anyone with a role here"],
            ["everyone", "Everyone in the organization"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex items-center gap-2 text-body-sm text-ink"
          >
            <RadioGroupItem value={value} aria-label={label} />
            {label}
          </label>
        ))}
      </RadioGroup>
      <div className="flex items-center gap-3 border-t border-hairline pt-3">
        <span className="flex-1">
          <FormMessage message={message} />
        </span>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  )
}

/** Optional modules this kind of organization can run, switched on or off. */
export function ModulesCard({
  slug,
  org,
  onSaved,
}: {
  slug: string
  org: Summary["org"]
  onSaved: () => void
}) {
  // What the server allows here: the kind's modules, as the platform has set them.
  const options = org.moduleOptions ?? []
  const available = options.map((o) => o.key)
  // Allowed for this kind, but not in the organization's plan (billing): buy it first.
  const notInPlan = new Set(
    options.filter((o) => o.inPlan === false).map((o) => o.key)
  )
  const toggle = useMutation({
    mutationFn: ({ key, on }: { key: ModuleKey; on: boolean }) =>
      api(`/orgs/${slug}`, {
        method: "PATCH",
        body: { modules: { [key]: on } },
      }),
    onSuccess: onSaved,
  })
  if (available.length === 0) return null
  return (
    <Card className="mt-4 grid gap-1" data-testid="org-modules">
      <h2 className="font-semibold text-ink">Modules</h2>
      <p className="mb-2 text-caption">
        Turn on what this {ORG_TYPE[org.type].toLowerCase()} needs. Each module
        adds its pages to the sidebar for people whose role allows them.
      </p>
      {available.map((key) => {
        const m = MODULES[key]
        const on = org.modules.includes(key)
        const locked = notInPlan.has(key)
        return (
          <label
            key={key}
            data-testid={`module-${key}`}
            className={cn(
              "flex items-start justify-between gap-4 border-t border-hairline py-3",
              (!m.ready || locked) && "opacity-60"
            )}
          >
            <span className="grid gap-0.5">
              <span className="flex items-center gap-2 text-body-sm text-ink">
                {m.label}
                {!m.ready && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                    Coming soon
                  </span>
                )}
                {m.ready && locked && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                    Not in your plan
                  </span>
                )}
              </span>
              <span className="text-xs text-body">{m.description}</span>
            </span>
            <Switch
              aria-label={m.label}
              checked={on}
              disabled={!m.ready || locked || toggle.isPending}
              onCheckedChange={(next) => toggle.mutate({ key, on: next })}
            />
          </label>
        )
      })}
      {toggle.error && (
        <FormMessage message={{ text: toggle.error.message, kind: "err" }} />
      )}
    </Card>
  )
}
