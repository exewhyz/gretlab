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
import { Card, PageTitle } from "@/features/admin/components/shell"
import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"

import { ORG_TYPE } from "./public"

import { useSummary, type Message, type Summary } from "./manage-shared"

export function ManageSettings({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const { data } = useSummary(slug)
  if (!data) return null
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
      <ModulesCard slug={slug} org={initial} onSaved={onSaved} />
    </>
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
        return (
          <label
            key={key}
            data-testid={`module-${key}`}
            className={cn(
              "flex items-start justify-between gap-4 border-t border-hairline py-3",
              !m.ready && "opacity-60"
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
              </span>
              <span className="text-xs text-body">{m.description}</span>
            </span>
            <Switch
              aria-label={m.label}
              checked={on}
              disabled={!m.ready || toggle.isPending}
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
