"use client"

import { CopyIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PERMISSIONS, type Permission } from "@workspace/judge"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { cn } from "@workspace/ui/lib/utils"

import { EditorSheet } from "@/components/editor-sheet"
import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { PermissionPicker } from "@/features/orgs/components/permission-picker"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { listIntegrations } from "@/features/integrations/server"
import { formatDateTime } from "@/lib/format"
import type {
  createApiKey,
  createWebhook,
} from "@/features/integrations/server"

type Data = ApiResult<typeof listIntegrations>

/** A value shown once, with a copy button. */
function Secret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-1.5">
      <span className="text-caption">{label}</span>
      <div className="flex items-center gap-2">
        <code
          data-testid="shown-secret"
          className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-ink"
        >
          {value}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(value)
              .then(() => setCopied(true))
          }
        >
          <CopyIcon /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-caption">
        Keep it somewhere safe now: it won&apos;t be shown again.
      </p>
    </div>
  )
}

/** Manage › Integrations: API keys for other systems, and webhooks that tell them what happened. */
export function ManageIntegrations({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "integrations"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Data>(`/orgs/${slug}/integrations`),
  })
  const refresh = () => void client.invalidateQueries({ queryKey: key })
  const [making, setMaking] = useState<"key" | "webhook" | null>(null)
  const [shown, setShown] = useState<{ label: string; value: string } | null>(
    null
  )

  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/integrations/keys/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  const toggle = useMutation({
    mutationFn: (h: { id: string; active: boolean }) =>
      api(`/orgs/${slug}/integrations/webhooks/${h.id}`, {
        method: "PATCH",
        body: { active: h.active },
      }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/integrations/webhooks/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  const ping = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/integrations/webhooks/${id}/ping`, { body: {} }),
    onSuccess: refresh,
  })
  if (!data) return <Loading error={error} />
  const live = data.keys.filter((k) => !k.revokedAt)
  const areaLabel = (e: string) =>
    e === "*"
      ? "Everything"
      : e.endsWith(".*")
        ? (data.areas.find((a) => `${a.key}.*` === e)?.label ?? e)
        : e

  return (
    <>
      <PageTitle>Integrations</PageTitle>
      <p className="mb-5 max-w-2xl text-body-sm text-body">
        Connect other systems: an API key lets one read or change things here
        with the permissions you give it; a webhook tells one, as it happens,
        what changed. See the API guide for the details.
      </p>

      <section className="mb-8 grid gap-3" aria-labelledby="keys-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="keys-heading" className="text-title-sm text-ink">
            API keys
          </h2>
          <Button size="sm" onClick={() => setMaking("key")}>
            New key
          </Button>
        </div>
        {data.keys.length === 0 ? (
          <Empty className="border border-dashed border-hairline">
            <EmptyHeader>
              <EmptyTitle>No API keys</EmptyTitle>
              <EmptyDescription>
                Make one for each system that connects, so each can be revoked
                on its own.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table headers={["Name", "Key", "May", "Last used", ""]}>
            {data.keys.map((k) => (
              <tr
                key={k.id}
                data-testid="api-key-row"
                className={cn(k.revokedAt && "opacity-60")}
              >
                <td>
                  <div className="text-ink">{k.name}</div>
                  <div className="text-xs">by {k.madeBy}</div>
                </td>
                <td className="font-mono text-xs">{k.prefix}</td>
                <td className="text-xs">
                  {k.permissions
                    .slice(0, 3)
                    .map((p) => PERMISSIONS[p as Permission]?.label ?? p)
                    .join(", ")}
                  {k.permissions.length > 3 &&
                    ` and ${k.permissions.length - 3} more`}
                </td>
                <td className="text-xs">
                  {k.revokedAt
                    ? `Revoked ${formatDateTime(k.revokedAt)}`
                    : k.lastUsedAt
                      ? formatDateTime(k.lastUsedAt)
                      : "Not yet"}
                </td>
                <td className="text-right">
                  {!k.revokedAt && (
                    <ConfirmButton
                      size="xs"
                      variant="ghost"
                      title={`Revoke "${k.name}"?`}
                      description="Whatever uses it stops working at once. This can't be undone; make a new key to reconnect."
                      confirmLabel="Revoke"
                      onConfirm={() => revoke.mutate(k.id)}
                    >
                      Revoke
                    </ConfirmButton>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {live.length > 0 && (
          <p className="text-caption">
            Send a key as <code>Authorization: Bearer glk_…</code> to{" "}
            <code>/api/v1/orgs/{slug}/…</code>. It acts as the person who made
            it, limited to what it may do, and its changes are in the activity
            log under its name.
          </p>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="hooks-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="hooks-heading" className="text-title-sm text-ink">
            Webhooks
          </h2>
          <Button size="sm" onClick={() => setMaking("webhook")}>
            New webhook
          </Button>
        </div>
        {data.webhooks.length === 0 ? (
          <Empty className="border border-dashed border-hairline">
            <EmptyHeader>
              <EmptyTitle>No webhooks</EmptyTitle>
              <EmptyDescription>
                A webhook posts each change you choose (leave decided, a member
                added, results published) to an address of yours, signed so you
                can tell it&apos;s from here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          data.webhooks.map((h) => (
            <Card key={h.id} className="grid gap-3" data-testid="webhook">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs break-all text-ink">
                    {h.url}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {h.events.map((e) => (
                      <Badge key={e} variant="secondary">
                        {areaLabel(e)}
                      </Badge>
                    ))}
                    {!h.active && <Badge variant="outline">Paused</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={ping.isPending}
                    onClick={() => ping.mutate(h.id)}
                  >
                    Send a test
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      toggle.mutate({ id: h.id, active: !h.active })
                    }
                  >
                    {h.active ? "Pause" : "Turn on"}
                  </Button>
                  <ConfirmButton
                    size="xs"
                    variant="ghost"
                    title="Remove this webhook?"
                    description="Nothing more is sent to it, and its delivery history goes."
                    confirmLabel="Remove"
                    onConfirm={() => remove.mutate(h.id)}
                  >
                    Remove
                  </ConfirmButton>
                </div>
              </div>
              {h.deliveries.length > 0 ? (
                <ul
                  className="grid gap-1 text-xs"
                  aria-label="Recent deliveries"
                >
                  {h.deliveries.map((d) => (
                    <li
                      key={d.id}
                      data-testid="delivery"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Badge
                        variant={
                          d.status === "sent"
                            ? "secondary"
                            : d.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {d.status === "sent"
                          ? "Delivered"
                          : d.status === "failed"
                            ? "Gave up"
                            : d.attempts
                              ? "Retrying"
                              : "Waiting"}
                      </Badge>
                      <span className="font-mono text-ink">{d.event}</span>
                      <span className="text-body">
                        {formatDateTime(d.createdAt)}
                        {d.responseStatus !== null &&
                          ` · HTTP ${d.responseStatus}`}
                        {d.lastError &&
                          d.status !== "sent" &&
                          ` · ${d.lastError}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-caption">Nothing sent yet.</p>
              )}
            </Card>
          ))
        )}
      </section>

      <NewKey
        slug={slug}
        open={making === "key"}
        grantable={data.grantable}
        onClose={() => setMaking(null)}
        onMade={(token) => {
          setMaking(null)
          setShown({ label: "Your new API key", value: token })
          refresh()
        }}
      />
      <NewWebhook
        slug={slug}
        open={making === "webhook"}
        areas={data.areas}
        onClose={() => setMaking(null)}
        onMade={(secret) => {
          setMaking(null)
          setShown({ label: "The webhook's signing secret", value: secret })
          refresh()
        }}
      />
      <Dialog open={shown !== null} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy it now</DialogTitle>
            <DialogDescription>
              Only a fingerprint of it is kept here.
            </DialogDescription>
          </DialogHeader>
          {shown && <Secret label={shown.label} value={shown.value} />}
          <DialogFooter>
            <Button onClick={() => setShown(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function NewKey({
  slug,
  open,
  grantable,
  onClose,
  onMade,
}: {
  slug: string
  open: boolean
  grantable: string[]
  onClose: () => void
  onMade: (token: string) => void
}) {
  const [name, setName] = useState("")
  const [permissions, setPermissions] = useState<string[]>([])
  const make = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof createApiKey>>(`/orgs/${slug}/integrations/keys`, {
        body: { name, permissions },
      }),
    onSuccess: (r) => {
      setName("")
      setPermissions([])
      onMade(r.token)
    },
  })
  if (!open) return null
  return (
    <EditorSheet
      title="New API key"
      description="It may only do what you choose, from what you can do across the organization."
      error={make.error?.message}
      submitLabel="Make key"
      submitDisabled={!name.trim() || permissions.length === 0 || make.isPending}
      onSubmit={() => make.mutate()}
      onClose={onClose}
      testId="new-api-key"
    >
      <Field label="Name">
        <TextInput
          value={name}
          placeholder="e.g. Student information system"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <PermissionPicker
        catalog={PERMISSIONS}
        order={Object.keys(PERMISSIONS)}
        held={grantable}
        value={permissions}
        onChange={setPermissions}
      />
    </EditorSheet>
  )
}

function NewWebhook({
  slug,
  open,
  areas,
  onClose,
  onMade,
}: {
  slug: string
  open: boolean
  areas: { key: string; label: string }[]
  onClose: () => void
  onMade: (secret: string) => void
}) {
  const [url, setUrl] = useState("")
  const [all, setAll] = useState(true)
  const [chosen, setChosen] = useState<string[]>([])
  const make = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof createWebhook>>(
        `/orgs/${slug}/integrations/webhooks`,
        {
          body: { url, events: all ? ["*"] : chosen.map((a) => `${a}.*`) },
        }
      ),
    onSuccess: (r) => {
      setUrl("")
      setChosen([])
      setAll(true)
      onMade(r.secret)
    },
  })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New webhook</DialogTitle>
          <DialogDescription>
            Each change is posted as JSON to this address, with a
            Gretlab-Signature header to check.
          </DialogDescription>
        </DialogHeader>
        <Field label="Address">
          <TextInput
            value={url}
            placeholder="https://example.com/hooks/gretlab"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-caption">Send</legend>
          <label className="flex items-center gap-2 text-body-sm">
            <input type="radio" checked={all} onChange={() => setAll(true)} />
            Everything that changes
          </label>
          <label className="flex items-center gap-2 text-body-sm">
            <input type="radio" checked={!all} onChange={() => setAll(false)} />
            Only these areas
          </label>
          {!all && (
            <div className="grid grid-cols-2 gap-1.5 pl-6 sm:grid-cols-3">
              {areas.map((a) => (
                <label
                  key={a.key}
                  className="flex items-center gap-2 text-body-sm"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(a.key)}
                    onChange={(e) =>
                      setChosen((cur) =>
                        e.target.checked
                          ? [...cur, a.key]
                          : cur.filter((x) => x !== a.key)
                      )
                    }
                  />
                  {a.label}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {make.error && (
          <FormMessage message={{ text: make.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !url.trim() || (!all && chosen.length === 0) || make.isPending
            }
            onClick={() => make.mutate()}
          >
            Add webhook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
