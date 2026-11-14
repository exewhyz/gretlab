"use client"

import { CopyIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { useGroups } from "@/features/orgs/components/manage-shared"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { orgLti } from "@/features/lti/org"

interface Platform {
  id: string
  name: string
  issuer: string
  clientId: string
  deploymentIds: string[]
  authUrl: string
  tokenUrl: string
  jwksUrl: string
  contexts: {
    id: string
    contextId: string
    title: string
    groupId: string | null
  }[]
}

type Data = ApiResult<typeof orgLti>

/** Manage › LMS: connect Moodle, Canvas or Blackboard with LTI 1.3, and link their courses to classes. */
export function LmsSettings({ slug }: { slug: string }) {
  const key = ["org", slug, "lti"]
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Data>(`/orgs/${slug}/lti`),
  })
  const groups = useGroups(slug)
  const [editing, setEditing] = useState<Platform | "new" | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/lti/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  const link = useMutation({
    mutationFn: ({ id, groupId }: { id: string; groupId: string | null }) =>
      api(`/orgs/${slug}/lti/contexts/${id}`, {
        method: "PUT",
        body: { groupId },
      }),
    onSuccess: refresh,
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle
        action={
          <Button onClick={() => setEditing("new")}>Connect an LMS</Button>
        }
      >
        LMS (LTI 1.3)
      </PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        Connect Moodle, Canvas, Blackboard or another LMS. Links in its courses
        open Gretlab with people signed in, in the class you link the course to,
        and grades go back to its gradebook.
      </p>
      <Card className="mb-4 grid gap-2" data-testid="lti-tool">
        <h2 className="font-semibold text-ink">Give your LMS these</h2>
        <p className="text-caption">
          Add Gretlab as an LTI 1.3 tool (in Moodle: Site administration ›
          Plugins › External tool › Manage tools; in Canvas: Developer Keys ›
          LTI Key). Share email and name, and turn on Deep Linking and
          Assignment and Grade Services.
        </p>
        <Copyable
          label="Login (initiate login) URL"
          value={data.tool.loginUrl}
        />
        <Copyable label="Redirect / launch URL" value={data.tool.launchUrl} />
        <Copyable label="Deep linking URL" value={data.tool.deepLinkUrl} />
        <Copyable label="Public keyset (JWKS) URL" value={data.tool.jwksUrl} />
        <Copyable label="Domain" value={data.tool.domain} />
      </Card>
      {data.platforms.length === 0 ? (
        <Card>No LMS connected yet.</Card>
      ) : (
        <div className="grid gap-3">
          {data.platforms.map((p) => (
            <Card key={p.id} className="grid gap-2" data-testid="lti-platform">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-ink">{p.name}</h2>
                  <p className="text-caption">
                    {p.issuer} · client {p.clientId} · {p.deploymentIds.length}{" "}
                    deployment
                    {p.deploymentIds.length === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </Button>
                  <ConfirmButton
                    size="sm"
                    variant="destructive"
                    title={`Disconnect ${p.name}?`}
                    description="Its links stop opening Gretlab and grades stop going back. People keep their accounts and work."
                    confirmLabel="Disconnect"
                    onConfirm={() => remove.mutate(p.id)}
                  >
                    Disconnect
                  </ConfirmButton>
                </span>
              </div>
              <h3 className="text-body-sm font-semibold text-ink">Courses</h3>
              {p.contexts.length === 0 ? (
                <p className="text-caption">
                  Courses appear here after their first launch. Then link each
                  to a class.
                </p>
              ) : (
                <ul className="grid gap-1">
                  {p.contexts.map((c) => (
                    <li
                      key={c.id}
                      data-testid="lti-course"
                      className="flex flex-wrap items-center gap-2 text-body-sm"
                    >
                      <span className="min-w-48 flex-1 text-ink">
                        {c.title || c.contextId}
                      </span>
                      {groups.data && (
                        <GroupPicker
                          label={`Class for ${c.title || c.contextId}`}
                          placeholder="Not linked"
                          className="w-64"
                          groups={groups.data.groups}
                          levels={groups.data.levels}
                          value={c.groupId ?? ""}
                          onChange={(groupId) =>
                            link.mutate({ id: c.id, groupId })
                          }
                        />
                      )}
                      {c.groupId && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            link.mutate({ id: c.id, groupId: null })
                          }
                        >
                          Unlink
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
      {(remove.error ?? link.error) && (
        <FormMessage
          message={{ text: (remove.error ?? link.error)!.message, kind: "err" }}
        />
      )}
      {editing && (
        <PlatformDialog
          slug={slug}
          platform={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
    </>
  )
}

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-1 sm:grid-cols-[14rem_1fr_auto] sm:items-center">
      <span className="text-caption">{label}</span>
      <TextInput
        aria-label={label}
        readOnly
        value={value}
        className="font-mono text-xs"
      />
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(value)
          setCopied(true)
        }}
      >
        <CopyIcon /> {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

function PlatformDialog({
  slug,
  platform,
  onDone,
}: {
  slug: string
  platform: Platform | null
  onDone: () => void
}) {
  const [form, setForm] = useState({
    name: platform?.name ?? "",
    issuer: platform?.issuer ?? "",
    clientId: platform?.clientId ?? "",
    deploymentIds: (platform?.deploymentIds ?? []).join("\n"),
    authUrl: platform?.authUrl ?? "",
    tokenUrl: platform?.tokenUrl ?? "",
    jwksUrl: platform?.jwksUrl ?? "",
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        deploymentIds: form.deploymentIds.split(/[\s,]+/).filter(Boolean),
      }
      return platform
        ? api(`/orgs/${slug}/lti/${platform.id}`, { method: "PUT", body })
        : api(`/orgs/${slug}/lti`, { body })
    },
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"
        data-testid="lti-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {platform ? `Edit ${platform.name}` : "Connect an LMS"}
          </DialogTitle>
          <DialogDescription>
            From the LMS&apos;s tool registration (platform details).
          </DialogDescription>
        </DialogHeader>
        <Field label="Name">
          <TextInput
            aria-label="LMS name"
            placeholder="College Moodle"
            value={form.name}
            onChange={set("name")}
          />
        </Field>
        <Field label="Issuer (platform ID)">
          <TextInput
            aria-label="Issuer"
            placeholder="https://moodle.college.edu"
            value={form.issuer}
            onChange={set("issuer")}
          />
        </Field>
        <Field label="Client ID">
          <TextInput
            aria-label="Client ID"
            value={form.clientId}
            onChange={set("clientId")}
          />
        </Field>
        <Field label="Deployment IDs (one per line)">
          <TextArea
            rows={2}
            aria-label="Deployment IDs"
            value={form.deploymentIds}
            onChange={set("deploymentIds")}
          />
        </Field>
        <Field label="Authentication request URL">
          <TextInput
            aria-label="Authentication URL"
            placeholder="https://moodle.college.edu/mod/lti/auth.php"
            value={form.authUrl}
            onChange={set("authUrl")}
          />
        </Field>
        <Field label="Access token URL">
          <TextInput
            aria-label="Access token URL"
            placeholder="https://moodle.college.edu/mod/lti/token.php"
            value={form.tokenUrl}
            onChange={set("tokenUrl")}
          />
        </Field>
        <Field label="Public keyset URL">
          <TextInput
            aria-label="Keyset URL"
            placeholder="https://moodle.college.edu/mod/lti/certs.php"
            value={form.jwksUrl}
            onChange={set("jwksUrl")}
          />
        </Field>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={
              save.isPending ||
              !form.name.trim() ||
              !form.issuer.trim() ||
              !form.clientId.trim()
            }
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
