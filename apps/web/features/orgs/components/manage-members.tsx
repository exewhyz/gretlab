"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { type Permission } from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
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
  Loading,
  PageTitle,
  Table,
  Pager,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { listMembers } from "@/features/orgs/server"

import { GroupChecklist, leafIds } from "./group-checklist"
import { GroupPicker } from "./group-picker"

import {
  groupPath,
  useGroups,
  useRoles,
  useSummary,
  type Group,
  type Member,
  type Message,
  type Role,
  memberKind,
  type MemberKind,
} from "./manage-shared"

/** One page of the Members screen, as the paged form of the members route answers it. */
export type MembersPage = ApiResult<typeof listMembers>

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
  const [kind, setKindState] = useState<MemberKind | "">("")
  const [page, setPage] = useState(1)
  const setKind = (k: MemberKind | "") => {
    setKindState(k)
    setPage(1)
  }
  const [editing, setEditing] = useState<{
    id: string
    what: "groups" | "role"
  } | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const members = useQuery({
    queryKey: ["org", slug, "members", q, groupId, status, kind, page],
    queryFn: () =>
      api<MembersPage>(
        `/orgs/${slug}/members?${new URLSearchParams({ q, group: groupId, status, kind, page: String(page) })}`
      ),
    placeholderData: keepPreviousData,
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
  const terms = summary.org.kind?.terms
  const kindLabel: Record<MemberKind, string> = {
    staff: "Staff",
    learner: terms?.learners ?? "Students",
    parent: terms?.guardians ?? "Parents",
    other: "Others",
  }
  const { counts, total, pages } = members.data
  const shown = members.data.members

  return (
    <>
      <PageTitle>Members</PageTitle>
      <div
        role="group"
        aria-label="Show"
        className="mb-3 flex flex-wrap gap-1.5"
        data-testid="member-kinds"
      >
        {(
          [
            ["", "Everyone", counts.all],
            ...(["learner", "staff", "parent", "other"] as const)
              .filter((k) => counts[k] > 0)
              .map((k) => [k, kindLabel[k], counts[k]] as const),
          ] as const
        ).map(([k, label, n]) => (
          <Button
            key={k || "all"}
            size="sm"
            variant={kind === k ? "default" : "outline"}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {label}
            <span className="tabular-nums opacity-70">{n}</span>
          </Button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput
          aria-label="Search members"
          placeholder="Search by name or email"
          className="w-64"
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setPage(1)
          }}
        />
        <GroupPicker
          label="Group"
          className="w-64"
          heading="Show people in this group and the groups inside it."
          groups={list}
          levels={groups.data.levels}
          extra={[{ value: "", label: "Everyone" }]}
          value={groupId}
          onChange={(id) => {
            setGroupId(id)
            setPage(1)
          }}
        />
        <SelectInput
          aria-label="Status"
          className="w-48"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setPage(1)
          }}
        >
          <option value="">Members and requests</option>
          <option value="pending">Waiting for approval</option>
        </SelectInput>
      </div>
      <FormMessage message={message} />
      <div
        aria-busy={members.isPlaceholderData}
        className={cn(
          "transition-opacity",
          members.isPlaceholderData && "opacity-60"
        )}
      >
        <Table headers={["Person", "Groups", "Roles", ""]}>
          {shown.map((m) => (
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
              plainLabel={
                memberKind(m) === "learner"
                  ? (terms?.learner ?? "Student")
                  : memberKind(m) === "parent"
                    ? `${terms?.guardian ?? "Parent"} of ${m.children.join(", ")}`
                    : "Member"
              }
            />
          ))}
        </Table>
      </div>
      <Pager
        page={members.data.page}
        pages={pages}
        total={total}
        onPage={setPage}
      />
      {shown.length === 0 && (
        <p className="mt-3 text-body-sm text-body">Nobody matches.</p>
      )}
    </>
  )
}

/** Where someone sits: the first few groups, and the rest a click away. */
export function GroupChips({ paths }: { paths: string[] }) {
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

export function MemberRow({
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
  plainLabel,
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
  /** What they are when they hold no role beyond Member: Student, Parent of …, Member. */
  plainLabel: string
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
              <span className="text-xs">{plainLabel}</span>
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
