"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PERMISSIONS, type Permission } from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"
import { Field, FormMessage, TextInput } from "@/components/form"
import { ConfirmButton } from "@/components/confirm"
import { EditorSheet } from "@/components/editor-sheet"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

import { PermissionPicker } from "./permission-picker"

import { useRoles, useSummary, type Message, type Role } from "./manage-shared"
import type { suggestedRoles } from "@/features/orgs/server"

/** A role with more permissions than this shows the first few and the rest in a side sheet. */
const CHIPS_SHOWN = 12

/**
 * What a role allows. A long list (an owner holds ninety) shows its first dozen, and
 * "All 90 permissions" opens a side sheet listing every one by area, with what it allows.
 */
export function PermissionChips({
  permissions,
  name,
}: {
  permissions: string[]
  /** The role, for the sheet's title. */
  name?: string
}) {
  if (permissions.length === 0) {
    return <span className="text-xs text-body">No management access</span>
  }
  const entry = (p: string) =>
    PERMISSIONS[p as Permission] as
      { label: string; description?: string; module?: string } | undefined
  const chip = (p: string) => (
    <span
      key={p}
      className="rounded-full bg-muted px-2 py-0.5 text-xs text-ink"
    >
      {entry(p)?.label ?? p}
    </span>
  )
  if (permissions.length <= CHIPS_SHOWN + 2) {
    return <div className="flex flex-wrap gap-1">{permissions.map(chip)}</div>
  }
  // Areas in the catalogue's own order.
  const areas = [
    ...new Set(permissions.map((p) => entry(p)?.module ?? "Other")),
  ]
  return (
    <div className="flex flex-wrap items-center gap-1">
      {permissions.slice(0, CHIPS_SHOWN).map(chip)}
      <Sheet>
        <SheetTrigger render={<Button variant="outline" size="xs" />}>
          All {permissions.length} permissions
        </SheetTrigger>
        <SheetContent className="overflow-y-auto [--sheet-max-width:28rem] [--sheet-width:100%]">
          <SheetHeader>
            <SheetTitle>
              {name ? `${name}: ` : ""}
              {permissions.length} permissions
            </SheetTitle>
            <SheetDescription>
              Everything this role allows, by area.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 px-4 pb-6" data-testid="role-permissions">
            {areas.map((area) => (
              <section key={area} className="grid gap-2">
                <h3 className="text-caption font-medium text-muted-foreground">
                  {area}
                </h3>
                <ul className="grid gap-2">
                  {permissions
                    .filter((p) => (entry(p)?.module ?? "Other") === area)
                    .map((p) => (
                      <li key={p} className="grid gap-0.5">
                        <span className="text-body-sm font-medium text-ink">
                          {entry(p)?.label ?? p}
                        </span>
                        {entry(p)?.description && (
                          <span className="text-caption text-body">
                            {entry(p)?.description}
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        </SheetContent>
      </Sheet>
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
          canEdit && (
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
            <PermissionChips name={role.name} permissions={role.permissions} />
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
              <PermissionChips name={s.name} permissions={s.permissions} />
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
  // A side sheet over the list: who the role is for at the top, what it allows scrolling
  // in the middle (with search and a way to each area), and the buttons always in reach.
  return (
    <EditorSheet
      title={role ? `Edit ${role.name}` : "New role"}
      description="Choose what people with this role may do. You can only give permissions you hold."
      error={save.error?.message}
      submitLabel={role ? "Save role" : "Create role"}
      submitDisabled={save.isPending || !name.trim()}
      onSubmit={() => save.mutate()}
      onClose={onDone}
      testId="role-editor"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Role name">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Description">
          <TextInput
            value={description}
            placeholder="What it's for"
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
    </EditorSheet>
  )
}
