"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PERMISSIONS, type Permission } from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Field, FormMessage, TextInput } from "@/components/form"
import { ConfirmButton } from "@/components/confirm"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

import { PermissionPicker } from "./permission-picker"

import { useRoles, useSummary, type Message, type Role } from "./manage-shared"
import type { suggestedRoles } from "@/features/orgs/server"

export function PermissionChips({ permissions }: { permissions: string[] }) {
  if (permissions.length === 0) {
    return <span className="text-xs text-body">No management access</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {permissions.map((p) => (
        <span
          key={p}
          className="rounded-full bg-muted px-2 py-0.5 text-xs text-ink"
        >
          {PERMISSIONS[p as Permission]?.label ?? p}
        </span>
      ))}
    </div>
  )
}

export function ManageRoles({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const { data: summary } = useSummary(slug)
  const { data, error } = useRoles(slug)
  const [editing, setEditing] = useState<Role | "new" | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/roles/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["org", slug] }),
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  if (!data || !summary) return <Loading error={error} />
  const canEdit = summary.orgWide.includes("org.roles.manage")

  return (
    <>
      <PageTitle
        action={
          canEdit &&
          editing === null && (
            <Button size="sm" onClick={() => setEditing("new")}>
              New role
            </Button>
          )
        }
      >
        Roles
      </PageTitle>
      <p className="mb-4 max-w-3xl text-caption text-body">
        A role is a set of permissions. Give it to someone across the whole
        organization or only within one group, from the Members page. Nobody can
        give out a permission they don&apos;t have.
      </p>
      <FormMessage message={message} />
      {editing !== null && (
        <RoleEditor
          slug={slug}
          role={editing === "new" ? null : editing}
          held={summary.isOwner ? null : summary.orgWide}
          onDone={() => setEditing(null)}
        />
      )}
      <div className="grid gap-3">
        {data.map((role) => (
          <Card key={role.id} className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-title-sm text-ink">{role.name}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                {role.systemKey
                  ? "Built in"
                  : role.templateKey
                    ? "Suggested"
                    : "Custom"}
              </span>
              <span className="text-xs text-body">
                {role.assigned} {role.assigned === 1 ? "person" : "people"}
              </span>
              <span className="flex-1" />
              {canEdit && !role.systemKey && (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setEditing(role)}
                  >
                    Edit
                  </Button>
                  <DeleteRole
                    name={role.name}
                    onDelete={() => remove.mutate(role.id)}
                  />
                </>
              )}
            </div>
            {role.description && (
              <p className="text-caption text-body">{role.description}</p>
            )}
            <PermissionChips permissions={role.permissions} />
          </Card>
        ))}
      </div>
      {canEdit && <SuggestedRoles slug={slug} onMessage={setMessage} />}
    </>
  )
}

export type Suggested = ApiResult<typeof suggestedRoles>

/** The kind's suggested roles this organization doesn't have yet, each one click to add. */
export function SuggestedRoles({
  slug,
  onMessage,
}: {
  slug: string
  onMessage: (m: Message) => void
}) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["org", slug, "roles", "suggested"],
    queryFn: () => api<Suggested>(`/orgs/${slug}/roles/suggested`),
  })
  const add = useMutation({
    mutationFn: (key: string) =>
      api(`/orgs/${slug}/roles/suggested`, { body: { key } }),
    onSuccess: () => {
      onMessage(null)
      void queryClient.invalidateQueries({ queryKey: ["org", slug] })
    },
    onError: (e) => onMessage({ text: e.message, kind: "err" }),
  })
  if (!data || data.suggestions.length === 0) return null
  return (
    <section className="mt-6 grid gap-3" data-testid="suggested-roles">
      <div>
        <h2 className="text-title-md text-ink">
          Suggested for a {data.kind.toLowerCase()}
        </h2>
        <p className="text-caption text-body">
          Roles such places usually have. Add one and change it as you like.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {data.suggestions.map((s) => (
          <Card
            key={s.key}
            className="grid content-between gap-2"
            data-testid="suggested-role"
          >
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-title-sm text-ink">{s.name}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                  {s.scope === "group"
                    ? "Given within a group"
                    : "Organization-wide"}
                </span>
              </div>
              <p className="text-caption text-body">{s.description}</p>
              <PermissionChips permissions={s.permissions} />
            </div>
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={add.isPending || s.nameTaken || !s.allowed}
                title={
                  s.nameTaken
                    ? `There's already a role called ${s.name}`
                    : !s.allowed
                      ? "It holds permissions you don't have"
                      : undefined
                }
                aria-label={`Add ${s.name}`}
                onClick={() => add.mutate(s.key)}
              >
                Add role
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}

export function DeleteRole({
  name,
  onDelete,
}: {
  name: string
  onDelete: () => void
}) {
  return (
    <ConfirmButton
      size="xs"
      variant="ghost"
      title={`Delete the ${name} role?`}
      description="Everyone who has it loses what it allowed at once. This can't be undone."
      confirmLabel="Delete role"
      onConfirm={onDelete}
    >
      Delete
    </ConfirmButton>
  )
}

export function RoleEditor({
  slug,
  role,
  held,
  onDone,
}: {
  slug: string
  role: Role | null
  /** What this person may hand out, or null for everything. */
  held: Permission[] | null
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(role?.name ?? "")
  const [description, setDescription] = useState(role?.description ?? "")
  const [permissions, setPermissions] = useState<string[]>(
    role?.permissions ?? []
  )
  const save = useMutation({
    mutationFn: () =>
      role
        ? api(`/orgs/${slug}/roles/${role.id}`, {
            method: "PUT",
            body: { name, description, permissions },
          })
        : api(`/orgs/${slug}/roles`, {
            body: { name, description, permissions },
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", slug] })
      onDone()
    },
  })
  return (
    <Card className="mb-4 grid gap-4">
      <div className="grid gap-3 min-[901px]:grid-cols-2">
        <Field label="Role name">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Description">
          <TextInput
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
      <PermissionPicker
        catalog={PERMISSIONS}
        order={Object.keys(PERMISSIONS)}
        held={held}
        value={permissions}
        onChange={setPermissions}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        <span className="flex-1">
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </span>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending || !name.trim()}
          onClick={() => save.mutate()}
        >
          {role ? "Save role" : "Create role"}
        </Button>
      </div>
    </Card>
  )
}
