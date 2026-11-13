"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  MODULE_KEYS,
  MODULES,
  moduleAvailable,
  PERMISSIONS,
  type ModuleKey,
  type Permission,
} from "@workspace/judge"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Switch } from "@workspace/ui/components/switch"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { ConfirmButton } from "@/components/confirm"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { useViewer } from "@/features/account/use-viewer"
import { OwnerProvider } from "@/features/admin/owner"
import { AuditLog } from "@/features/audit/components/audit-log"
import { OrgShell } from "@/features/home/components/org-shell"
import { api } from "@/lib/api/client"
import { PermissionPicker } from "./permission-picker"

import { GroupChecklist, leafIds } from "./group-checklist"
import { GroupPicker } from "./group-picker"
import { formatDateTime } from "@/lib/format"
import { readXlsx, toCsv } from "@/lib/xlsx"

import { ORG_TYPE, type OrgType } from "./public"

import {
  groupPath,
  useGroups,
  useRoles,
  useSummary,
  type Group,
  type Member,
  type Message,
  type Role,
  type Summary,
} from "./manage-shared"

/* ---------- shell ---------- */

export function ManageShell({
  slug,
  children,
}: {
  slug: string
  children: ReactNode
}) {
  const { data, error } = useSummary(slug)
  // The school frame (features/home/components/org-shell.tsx) draws the sidebar and header.
  return (
    <OrgShell slug={slug}>
      {data ? (
        // The shared dashboard editors work for this organization inside here.
        <OwnerProvider orgSlug={slug}>{children}</OwnerProvider>
      ) : (
        <Loading error={error} />
      )}
    </OrgShell>
  )
}

/* ---------- overview ---------- */

export function ManageOverview({ slug }: { slug: string }) {
  const { data } = useSummary(slug)
  if (!data) return null
  const base = `/orgs/${slug}/manage`
  const cards = [
    ["Members", data.counts.members, `${base}/members`],
    [
      "Waiting for approval",
      data.counts.pending,
      `${base}/members?status=pending`,
    ],
    ["Groups", data.counts.groups, `${base}/groups`],
    ["Active invite links", data.counts.invites, `${base}/invites`],
  ] as const
  return (
    <>
      <PageTitle>{data.org.name}</PageTitle>
      <div className="mb-5 grid grid-cols-2 gap-3 min-[901px]:grid-cols-4">
        {cards.map(([label, value, href]) => (
          <Link key={label} href={href} className="hover:opacity-80">
            <Card>
              <div className="text-display-sm text-ink tabular-nums">
                {value}
              </div>
              <div className="text-caption">{label} →</div>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="grid gap-2 text-body-sm">
        <h2 className="text-title-sm text-ink">Getting people in</h2>
        <ol className="grid list-decimal gap-1.5 pl-5 text-body">
          <li>
            Set up your{" "}
            {data.org.groupLevels.map((l) => l.toLowerCase()).join(" and ")}{" "}
            structure under{" "}
            <Link href={`${base}/groups`} className="underline">
              Groups
            </Link>
            .
          </li>
          <li>
            Create an invite link for each{" "}
            {data.org.groupLevels.at(-1)?.toLowerCase()} under{" "}
            <Link href={`${base}/invites`} className="underline">
              Invites
            </Link>
            ; people who use it land in that group with the role you chose.
          </li>
          <li>
            Or add your email domain in{" "}
            <Link href={`${base}/settings`} className="underline">
              Settings
            </Link>{" "}
            so people with it join without waiting.
          </li>
        </ol>
      </Card>
    </>
  )
}

/* ---------- members ---------- */

export function ManageMembers({
  slug,
  initialStatus,
}: {
  slug: string
  initialStatus?: string
}) {
  const queryClient = useQueryClient()
  const { data: summary } = useSummary(slug)
  const groups = useGroups(slug)
  const roles = useRoles(slug)
  const [q, setQ] = useState("")
  const [groupId, setGroupId] = useState("")
  const [status, setStatus] = useState(
    initialStatus === "pending" ? "pending" : ""
  )
  const [editing, setEditing] = useState<{
    id: string
    what: "groups" | "role"
  } | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const members = useQuery({
    queryKey: ["org", slug, "members", q, groupId, status],
    queryFn: () =>
      api<Member[]>(
        `/orgs/${slug}/members?q=${encodeURIComponent(q)}&group=${groupId}&status=${status}`
      ),
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["org", slug] })
  }
  const act = useMutation({
    mutationFn: (call: () => Promise<unknown>) => call(),
    onSuccess: () => {
      refresh()
      setEditing(null)
      setMessage(null)
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  if (!summary || !groups.data || !members.data) {
    return <Loading error={members.error ?? groups.error} />
  }
  const can = (p: Permission) => summary.permissions.includes(p)
  const list = groups.data.groups

  return (
    <>
      <PageTitle>Members</PageTitle>
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput
          aria-label="Search members"
          placeholder="Search by name or email"
          className="w-64"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <GroupPicker
          label="Group"
          className="w-64"
          heading="Show people in this group and the groups inside it."
          groups={list}
          levels={groups.data.levels}
          extra={[{ value: "", label: "Everyone" }]}
          value={groupId}
          onChange={setGroupId}
        />
        <SelectInput
          aria-label="Status"
          className="w-48"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Members and requests</option>
          <option value="pending">Waiting for approval</option>
        </SelectInput>
      </div>
      <FormMessage message={message} />
      <Table headers={["Person", "Groups", "Roles", ""]}>
        {members.data.map((m) => (
          <MemberRow
            key={m.userId}
            slug={slug}
            member={m}
            groups={list}
            levels={groups.data.levels}
            roles={roles.data ?? []}
            canApprove={can("org.members.invite")}
            canManage={can("org.members.manage")}
            canRoles={can("org.roles.manage")}
            editing={editing?.id === m.userId ? editing.what : null}
            setEditing={(what) =>
              setEditing(what ? { id: m.userId, what } : null)
            }
            run={(call) => act.mutate(call)}
            busy={act.isPending}
          />
        ))}
      </Table>
      {members.data.length === 0 && (
        <p className="mt-3 text-body-sm text-body">Nobody matches.</p>
      )}
    </>
  )
}

/** Where someone sits: the first few groups, and the rest a click away. */
function GroupChips({ paths }: { paths: string[] }) {
  const SHOWN = 3
  const chip = (path: string) => (
    <span
      key={path}
      className="max-w-56 truncate rounded-full bg-muted px-2 py-0.5 text-xs text-ink"
      title={path}
    >
      {path}
    </span>
  )
  if (paths.length === 0) return <span className="text-xs">—</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {paths.slice(0, SHOWN).map(chip)}
      {paths.length > SHOWN && (
        <Popover>
          <PopoverTrigger
            render={<Button size="xs" variant="ghost" className="h-5 px-1.5" />}
          >
            +{paths.length - SHOWN} more
          </PopoverTrigger>
          <PopoverContent className="grid max-h-72 w-72 gap-1 overflow-auto p-2">
            <p className="text-caption text-body">In {paths.length} groups</p>
            {[...paths].sort().map((path) => (
              <span key={path} className="text-xs text-ink">
                {path}
              </span>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function MemberRow({
  slug,
  member: m,
  groups,
  levels,
  roles,
  canApprove,
  canManage,
  canRoles,
  editing,
  setEditing,
  run,
  busy,
}: {
  slug: string
  member: Member
  groups: Group[]
  levels: string[]
  roles: Role[]
  canApprove: boolean
  canManage: boolean
  canRoles: boolean
  editing: "groups" | "role" | null
  setEditing: (what: "groups" | "role" | null) => void
  run: (call: () => Promise<unknown>) => void
  busy: boolean
}) {
  // Ticks show last-level groups; where they sit "not placed yet" stays until they're placed.
  const leaves = leafIds(groups)
  const placedIds = m.groupIds.filter((id) => leaves.includes(id))
  const [picked, setPicked] = useState<string[]>(placedIds)
  const parentOf = (id: string) =>
    groups.find((g) => g.id === id)?.parentId ?? null
  const above = (id: string): string[] => {
    const p = parentOf(id)
    return p ? [p, ...above(p)] : []
  }
  const toSave = () => {
    const chosen = picked.filter((id) => leaves.includes(id))
    const waiting = m.groupIds.filter(
      (id) => !leaves.includes(id) && !chosen.some((c) => above(c).includes(id))
    )
    return [...chosen, ...waiting]
  }
  const [roleId, setRoleId] = useState("")
  const [scope, setScope] = useState("")
  const remove = () =>
    run(() => api(`/orgs/${slug}/members/${m.userId}`, { method: "DELETE" }))
  const base = `/orgs/${slug}/members/${m.userId}`

  return (
    <tr data-testid="member-row" className="align-top">
      <td>
        <div className="text-ink">{m.name ?? m.email}</div>
        <div className="text-xs">{m.email}</div>
        {m.status === "pending" && (
          <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            Waiting for approval
          </span>
        )}
      </td>
      <td>
        <GroupChips
          paths={m.groupIds.map(
            (id) =>
              groupPath(groups, id) +
              (leaves.includes(id) ? "" : " (not placed yet)")
          )}
        />
        <Dialog
          open={editing === "groups"}
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Groups for {m.name ?? m.email}</DialogTitle>
              <DialogDescription>
                Tick where they sit. Ticking a group with groups inside puts
                them in every one of those.
              </DialogDescription>
            </DialogHeader>
            <GroupChecklist
              groups={groups}
              levels={levels}
              value={picked}
              onChange={setPicked}
              labelFor={(g) => `${g.name} for ${m.email}`}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api(base, { method: "PATCH", body: { groupIds: toSave() } })
                  )
                }
              >
                Save groups
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          {m.roles
            .filter((r) => r.systemKey !== "member")
            .map((r) => (
              <span
                key={r.assignmentId}
                className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-xs text-ink"
              >
                {r.name}
                {r.groupId && (
                  <span className="text-body">
                    · {groupPath(groups, r.groupId)}
                  </span>
                )}
                {canRoles && (
                  <ConfirmButton
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${r.name} from ${m.email}`}
                    className="size-auto p-0 text-body hover:bg-transparent hover:text-destructive"
                    title={`Take the ${r.name} role from ${m.name ?? m.email}?`}
                    description="They lose what it allowed at once. They stay a member."
                    confirmLabel="Take role"
                    onConfirm={() =>
                      run(() =>
                        api(
                          `/orgs/${slug}/role-assignments/${r.assignmentId}`,
                          {
                            method: "DELETE",
                          }
                        )
                      )
                    }
                  >
                    ✕
                  </ConfirmButton>
                )}
              </span>
            ))}
          {m.status === "active" &&
            m.roles.every((r) => r.systemKey === "member") && (
              <span className="text-xs">Member</span>
            )}
        </div>
        <Dialog
          open={editing === "role"}
          onOpenChange={(open) => !open && setEditing(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Give {m.name ?? m.email} a role</DialogTitle>
              <DialogDescription>
                A role for a group covers every group inside it.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Field label="Role">
                <SelectInput
                  aria-label="Role to give"
                  value={roleId}
                  onChange={(event) => setRoleId(event.target.value)}
                >
                  <option value="">Choose a role</option>
                  {roles
                    .filter((r) => r.systemKey !== "member")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </SelectInput>
              </Field>
              {roles.find((r) => r.id === roleId)?.description && (
                <p className="-mt-1 text-xs text-body">
                  {roles.find((r) => r.id === roleId)!.description}
                </p>
              )}
              <Field label="Where it applies">
                <GroupPicker
                  label="Where it applies"
                  heading="The role covers this group and every group inside it."
                  groups={groups}
                  levels={levels}
                  extra={[{ value: "", label: "Whole organization" }]}
                  value={scope}
                  onChange={setScope}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                disabled={!roleId || busy}
                onClick={() =>
                  run(() =>
                    api(`${base}/roles`, {
                      body: { roleId, groupId: scope || null },
                    })
                  )
                }
              >
                Give role
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
      <td className="text-right whitespace-nowrap">
        {m.status === "pending" ? (
          canApprove && (
            <span className="flex justify-end gap-1.5">
              <Button
                size="xs"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api(base, { method: "PATCH", body: { status: "active" } })
                  )
                }
              >
                Approve
              </Button>
              <ConfirmButton
                size="xs"
                variant="outline"
                disabled={busy}
                title={`Decline ${m.name ?? m.email}?`}
                description="Their request is dropped. They can ask again if the organization allows it."
                confirmLabel="Decline"
                onConfirm={remove}
              >
                Decline
              </ConfirmButton>
            </span>
          )
        ) : (
          <span className="flex justify-end gap-1">
            {canManage && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setPicked(placedIds)
                  setEditing("groups")
                }}
              >
                Groups
              </Button>
            )}
            {canRoles && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setRoleId("")
                  setScope("")
                  setEditing("role")
                }}
              >
                Add role
              </Button>
            )}
            {canManage && (
              <ConfirmButton
                size="xs"
                variant="ghost"
                disabled={busy}
                title={`Remove ${m.name ?? m.email} from the organization?`}
                description="They lose its groups, roles, assignments and contests. Their account and their own work stay; they'd need to join again."
                confirmLabel="Remove"
                onConfirm={remove}
              >
                Remove
              </ConfirmButton>
            )}
          </span>
        )}
      </td>
    </tr>
  )
}

/* ---------- groups ---------- */

/* ---------- roles ---------- */

function PermissionChips({ permissions }: { permissions: string[] }) {
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
                {role.systemKey ? "Built in" : "Custom"}
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
    </>
  )
}

function DeleteRole({
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

function RoleEditor({
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

/* ---------- invites ---------- */

interface Invite {
  id: string
  token: string
  label: string
  role: string
  group: string | null
  email: string | null
  uses: number
  maxUses: number | null
  expiresAt: string | null
  revoked: boolean
  createdAt: string
}

export function ManageInvites({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const groups = useGroups(slug)
  const roles = useRoles(slug)
  const [form, setForm] = useState({
    label: "",
    roleId: "",
    groupId: "",
    email: "",
    maxUses: "",
    expiresInDays: "7",
  })
  const [copied, setCopied] = useState<string | null>(null)
  const invites = useQuery({
    queryKey: ["org", slug, "invites"],
    queryFn: () => api<Invite[]>(`/orgs/${slug}/invites`),
  })
  const create = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/invites`, {
        body: {
          label: form.label,
          roleId: form.roleId || null,
          groupId: form.groupId || null,
          email: form.email.trim() || null,
          maxUses: form.maxUses ? Number(form.maxUses) : null,
          expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", slug] })
      setForm({ ...form, label: "", email: "" })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/invites/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["org", slug] }),
  })
  if (!invites.data || !groups.data) return <Loading error={invites.error} />
  const origin = typeof window === "undefined" ? "" : window.location.origin
  const set = (key: keyof typeof form, value: string) =>
    setForm({ ...form, [key]: value })

  return (
    <>
      <PageTitle>Invites</PageTitle>
      <Card className="mb-5 grid gap-3">
        <h2 className="text-title-sm text-ink">New invite link</h2>
        <div className="grid gap-3 min-[901px]:grid-cols-3">
          <Field label="Label" help="For you, e.g. CSE 2026-A students">
            <TextInput
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
            />
          </Field>
          <Field label="Joins as">
            <SelectInput
              value={form.roleId}
              onChange={(e) => set("roleId", e.target.value)}
            >
              <option value="">Member</option>
              {(roles.data ?? [])
                .filter(
                  (r) => r.systemKey !== "member" && r.systemKey !== "owner"
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </SelectInput>
          </Field>
          <Field
            label="Into group"
            help="A student invite into a group with groups inside joins every one of them."
          >
            <GroupPicker
              label="Into group"
              heading="Where people who join with this link are placed."
              groups={groups.data.groups}
              levels={groups.data.levels}
              extra={[{ value: "", label: "No group" }]}
              value={form.groupId}
              onChange={(id) => set("groupId", id)}
            />
          </Field>
          <Field
            label="Only for this email"
            help="Optional. Makes it a one-person invite."
          >
            <TextInput
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="How many people" help="Empty for no limit">
            <TextInput
              type="number"
              min={1}
              value={form.maxUses}
              onChange={(e) => set("maxUses", e.target.value)}
            />
          </Field>
          <Field label="Works for">
            <SelectInput
              value={form.expiresInDays}
              onChange={(e) => set("expiresInDays", e.target.value)}
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="365">A year</option>
              <option value="">Until turned off</option>
            </SelectInput>
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button
            className="self-start"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            Create link
          </Button>
          {create.error && (
            <FormMessage
              message={{ text: create.error.message, kind: "err" }}
            />
          )}
        </div>
      </Card>
      <Table headers={["Invite", "Link", "Joins as", "Used", "Status", ""]}>
        {invites.data.map((inv) => {
          const expired =
            inv.expiresAt !== null && new Date(inv.expiresAt) < new Date()
          const usedUp = inv.maxUses !== null && inv.uses >= inv.maxUses
          const live = !inv.revoked && !expired && !usedUp
          const url = `${origin}/join/${inv.token}`
          return (
            <tr key={inv.id} className={cn(!live && "opacity-60")}>
              <td>
                <div className="text-ink">{inv.label || "Invite link"}</div>
                {inv.email && <div className="text-xs">For {inv.email}</div>}
              </td>
              <td>
                <code data-testid="invite-link" className="text-xs break-all">
                  {url}
                </code>
                {live && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(url)
                      setCopied(inv.id)
                    }}
                  >
                    {copied === inv.id ? "Copied" : "Copy"}
                  </Button>
                )}
              </td>
              <td>
                {inv.role}
                {inv.group && <div className="text-xs">in {inv.group}</div>}
              </td>
              <td className="tabular-nums">
                {inv.uses}
                {inv.maxUses !== null && ` / ${inv.maxUses}`}
              </td>
              <td className="text-xs">
                {inv.revoked
                  ? "Turned off"
                  : usedUp
                    ? "Used up"
                    : expired
                      ? "Expired"
                      : inv.expiresAt
                        ? `Until ${formatDateTime(inv.expiresAt)}`
                        : "No expiry"}
              </td>
              <td className="text-right">
                {live && (
                  <RevokeInvite
                    label={inv.label}
                    onRevoke={() => revoke.mutate(inv.id)}
                  />
                )}
              </td>
            </tr>
          )
        })}
      </Table>
      {invites.data.length === 0 && (
        <p className="mt-3 text-body-sm text-body">No invite links yet.</p>
      )}
    </>
  )
}

function RevokeInvite({
  label,
  onRevoke,
}: {
  label: string
  onRevoke: () => void
}) {
  return (
    <ConfirmButton
      size="xs"
      variant="ghost"
      title={`Turn off ${label || "this invite link"}?`}
      description="The link stops working at once. People who already joined stay."
      confirmLabel="Turn off"
      onConfirm={onRevoke}
    >
      Turn off
    </ConfirmButton>
  )
}

/* ---------- settings ---------- */

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

function SettingsForm({
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
function ModulesCard({
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

/* ---------- activity ---------- */

export function ManageActivity({ slug }: { slug: string }) {
  return <AuditLog base={`/orgs/${slug}/audit`} />
}

/* ---------- import ---------- */

interface ImportRow {
  line: number
  email: string
  name: string
  group: string
  role: string
  action: "invite" | "add" | "update" | "unchanged" | "error"
  note: string
}

interface ImportResult {
  committed: boolean
  counts: Record<
    "invite" | "add" | "update" | "unchanged" | "error" | "newGroups",
    number
  >
  rows: ImportRow[]
}

/** A small CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  const src = text.replace(/^\uFEFF/, "")
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += c
  }
  if (field !== "" || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""))
}

const TEMPLATE =
  "email,name,group,role\nasha@college.edu,Asha Rao,CSE / 2026-A,\nravi@college.edu,Ravi Kumar,CSE / 2026-B,\nmeera@college.edu,Dr Meera Iyer,CSE,Teacher\n"

const ACTION_LABEL: Record<ImportRow["action"], string> = {
  invite: "New account",
  add: "Joins",
  update: "Update",
  unchanged: "No change",
  error: "Error",
}

export function ManageImport({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState("")
  const [createGroups, setCreateGroups] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  /** The CSV as rows of {email, name, group, role}, using the header row to find columns. */
  function rows() {
    const table = parseCsv(text)
    const header = (table[0] ?? []).map((h) => h.trim().toLowerCase())
    const col = (name: string) => header.indexOf(name)
    if (col("email") < 0) {
      throw new Error('The first line must be a header with an "email" column.')
    }
    return table.slice(1).map((cells) => ({
      email: cells[col("email")] ?? "",
      name: col("name") >= 0 ? (cells[col("name")] ?? "") : "",
      group: col("group") >= 0 ? (cells[col("group")] ?? "") : "",
      role: col("role") >= 0 ? (cells[col("role")] ?? "") : "",
    }))
  }

  const run = useMutation({
    mutationFn: (commit: boolean) =>
      api<ImportResult>(`/orgs/${slug}/import`, {
        body: { rows: rows(), createGroups, commit },
      }),
    onMutate: () => setProblem(null),
    onSuccess: (data) => {
      setResult(data)
      if (data.committed)
        void queryClient.invalidateQueries({ queryKey: ["org", slug] })
    },
    onError: (e) => setProblem(e.message),
  })
  const doable = result
    ? result.counts.invite + result.counts.add + result.counts.update
    : 0

  return (
    <>
      <PageTitle>Import members</PageTitle>
      <Card className="mb-4 grid gap-3">
        <p className="text-body-sm text-body">
          A CSV with a header row: <code>email</code> (required),{" "}
          <code>name</code>, <code>group</code> (a path from the top, like{" "}
          <code>CSE / 2026-A</code>) and <code>role</code> (a role&apos;s name;
          empty for Member). Upload a CSV or Excel (.xlsx) file, or paste the
          rows. People without an account get one, ready when they first sign
          in.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="members-template.csv"
            className="text-caption underline underline-offset-2"
          >
            Download a template
          </a>
          <label className="text-caption">
            <span className="sr-only">CSV or Excel file</span>
            <Input
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="CSV or Excel file"
              className="h-auto w-72 py-1.5 text-caption"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setResult(null)
                setProblem(null)
                try {
                  // Excel files are read in the browser and shown as CSV, so the same preview applies.
                  setText(
                    file.name.toLowerCase().endsWith(".xlsx")
                      ? toCsv(readXlsx(await file.arrayBuffer()))
                      : await file.text()
                  )
                } catch {
                  setProblem(
                    "Couldn't read that file. Save it as .xlsx or .csv and try again."
                  )
                }
              }}
            />
          </label>
        </div>
        <Field label="Or paste the CSV">
          <TextArea
            rows={6}
            value={text}
            className="font-mono text-xs"
            onChange={(event) => {
              setText(event.target.value)
              setResult(null)
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-body-sm text-ink">
          <Checkbox
            checked={createGroups}
            onCheckedChange={(checked) => {
              setCreateGroups(checked)
              setResult(null)
            }}
          />
          Create groups that don&apos;t exist yet
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!text.trim() || run.isPending}
            onClick={() => run.mutate(false)}
          >
            Check
          </Button>
          {result && !result.committed && doable > 0 && (
            <Button disabled={run.isPending} onClick={() => run.mutate(true)}>
              Import {doable} {doable === 1 ? "person" : "people"}
              {result.counts.error > 0 &&
                `, skip ${result.counts.error} with errors`}
            </Button>
          )}
          {problem && <FormMessage message={{ text: problem, kind: "err" }} />}
          {result?.committed && (
            <FormMessage
              message={{
                text: `Done: ${doable} imported${result.counts.newGroups ? `, ${result.counts.newGroups} groups created` : ""}.`,
                kind: "ok",
              }}
            />
          )}
        </div>
      </Card>
      {result && (
        <>
          <p
            data-testid="import-summary"
            className="mb-2 text-caption text-body"
          >
            {result.counts.invite} new accounts · {result.counts.add} join ·{" "}
            {result.counts.update} updated · {result.counts.unchanged} unchanged
            · {result.counts.error} errors
            {result.counts.newGroups > 0 &&
              ` · ${result.counts.newGroups} new groups`}
          </p>
          <Table
            headers={["Line", "Email", "Name", "Group", "Role", "What happens"]}
          >
            {result.rows.map((row) => (
              <tr key={row.line} data-testid="import-row">
                <td className="tabular-nums">{row.line}</td>
                <td className="text-ink">{row.email || "—"}</td>
                <td>{row.name}</td>
                <td>{row.group}</td>
                <td>{row.role}</td>
                <td
                  className={
                    row.action === "error" ? "text-destructive" : "text-ink"
                  }
                >
                  {ACTION_LABEL[row.action]}
                  <div className="text-xs text-body">{row.note}</div>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  )
}
