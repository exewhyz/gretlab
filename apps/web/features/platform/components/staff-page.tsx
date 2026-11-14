"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PLATFORM_PERMISSIONS, type PlatformPermission } from "@workspace/judge"

import { PermissionPicker } from "@/features/orgs/components/permission-picker"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { ConfirmButton } from "@/components/confirm"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { Loading, PageTitle, Table } from "@/features/admin/components/shell"
import { AuditLog } from "@/features/audit/components/audit-log"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { listRoles, listStaff } from "@/features/platform/staff"

type Staff = ApiResult<typeof listStaff>[number]

type Role = ApiResult<typeof listRoles>[number]

const SOURCE: Record<Staff["source"], string> = {
  role: "Given here",
  account: "From their account (before roles)",
  admin_emails: "ADMIN_EMAILS",
}

/** Platform staff and the roles they hold: who may do what on the platform. */
export function StaffPage() {
  const client = useQueryClient()
  const staff = useQuery({
    queryKey: ["admin", "staff"],
    queryFn: () => api<Staff[]>("/admin/staff"),
  })
  const roles = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => api<Role[]>("/admin/roles"),
  })
  const [giving, setGiving] = useState<{ email: string; role: string } | null>(
    null
  )
  const [editingRole, setEditingRole] = useState<Role | "new" | null>(null)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["admin", "staff"] })
    void client.invalidateQueries({ queryKey: ["admin", "roles"] })
    void client.invalidateQueries({ queryKey: ["me"] })
  }
  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/admin/staff/${userId}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  if (!staff.data || !roles.data)
    return <Loading error={staff.error ?? roles.error} />
  return (
    <>
      <PageTitle>Staff and roles</PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        Who may run the platform and what each may do. Nobody can give a role
        with permissions they don&apos;t hold, only owners make owners, and the
        platform always keeps one owner. Every change is in the activity log.
      </p>
      {remove.error && (
        <FormMessage message={{ text: remove.error.message, kind: "err" }} />
      )}
      <Tabs defaultValue="staff">
        <TabsList variant="line">
          <TabsTrigger value="staff">Staff ({staff.data.length})</TabsTrigger>
          <TabsTrigger value="roles">Roles ({roles.data.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="grid gap-3 pt-3">
          <Button
            size="sm"
            className="justify-self-start"
            onClick={() => setGiving({ email: "", role: "content_admin" })}
          >
            Add staff
          </Button>
          <Table headers={["Person", "Role", "How", ""]}>
            {staff.data.map((s) => (
              <tr key={s.userId} data-testid="staff-row">
                <td>
                  <div className="text-ink">{s.name ?? s.email}</div>
                  <div className="text-xs">{s.email}</div>
                </td>
                <td className="text-ink">{s.role.name}</td>
                <td className="text-caption">{SOURCE[s.source]}</td>
                <td className="text-right whitespace-nowrap">
                  {s.source !== "admin_emails" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Change ${s.email}'s role`}
                        onClick={() =>
                          setGiving({
                            email: s.email,
                            role: s.role.key ?? s.role.id ?? "",
                          })
                        }
                      >
                        Change role
                      </Button>
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        className="ml-1 text-destructive"
                        title={`Remove ${s.email} from platform staff?`}
                        description="They lose all platform access at once. Their own account stays."
                        confirmLabel="Remove"
                        onConfirm={() => remove.mutate(s.userId)}
                      >
                        Remove
                      </ConfirmButton>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </TabsContent>
        <TabsContent value="roles" className="grid gap-3 pt-3">
          <Button
            size="sm"
            className="justify-self-start"
            onClick={() => setEditingRole("new")}
          >
            New role
          </Button>
          <Table headers={["Role", "Can", "People", ""]}>
            {roles.data.map((r) => (
              <tr key={r.id} data-testid="role-row">
                <td>
                  <div className="text-ink">
                    {r.name}
                    {r.builtIn && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                        Built in
                      </span>
                    )}
                  </div>
                  <div className="text-xs">{r.description}</div>
                </td>
                <td className="max-w-96 text-caption">
                  <span className="line-clamp-2">
                    {r.permissions
                      .map((p) => PLATFORM_PERMISSIONS[p].label)
                      .join(", ") || "Nothing"}
                  </span>
                </td>
                <td className="tabular-nums">{r.members}</td>
                <td className="text-right">
                  {!r.builtIn && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingRole(r)}
                    >
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </TabsContent>
      </Tabs>
      {giving && (
        <GiveRoleDialog
          initial={giving}
          roles={roles.data}
          onDone={() => {
            setGiving(null)
            refresh()
          }}
        />
      )}
      {editingRole && (
        <RoleDialog
          role={editingRole === "new" ? null : editingRole}
          onDone={() => {
            setEditingRole(null)
            refresh()
          }}
        />
      )}
    </>
  )
}

function GiveRoleDialog({
  initial,
  roles,
  onDone,
}: {
  initial: { email: string; role: string }
  roles: Role[]
  onDone: () => void
}) {
  const [email, setEmail] = useState(initial.email)
  const [role, setRole] = useState(initial.role)
  const save = useMutation({
    mutationFn: () =>
      api("/admin/staff", { method: "PUT", body: { email, role } }),
    onSuccess: onDone,
  })
  const chosen = roles.find((r) => r.id === role)
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial.email ? "Change role" : "Add staff"}
          </DialogTitle>
          <DialogDescription>
            Their platform role. Someone new to the site gets an account that's
            ready when they first sign in.
          </DialogDescription>
        </DialogHeader>
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            disabled={Boolean(initial.email)}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Role">
          <SelectInput
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        {chosen && (
          <p className="text-caption">
            Can:{" "}
            {chosen.permissions
              .map((p) => PLATFORM_PERMISSIONS[p].label)
              .join(", ") || "nothing"}
          </p>
        )}
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!email || save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog({
  role,
  onDone,
}: {
  role: Role | null
  onDone: () => void
}) {
  const { data: viewer } = useViewer()
  const held = viewer?.user?.platform.permissions ?? []
  const [name, setName] = useState(role?.name ?? "")
  const [description, setDescription] = useState(role?.description ?? "")
  const [permissions, setPermissions] = useState<PlatformPermission[]>(
    role?.permissions ?? []
  )
  const save = useMutation({
    mutationFn: () =>
      role
        ? api(`/admin/roles/${role.id}`, {
            method: "PUT",
            body: { name, description, permissions },
          })
        : api("/admin/roles", { body: { name, description, permissions } }),
    onSuccess: onDone,
  })
  const remove = useMutation({
    mutationFn: () => api(`/admin/roles/${role!.id}`, { method: "DELETE" }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            A role is a set of permissions. You can only include ones you hold
            yourself.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <TextArea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <PermissionPicker
          catalog={PLATFORM_PERMISSIONS}
          order={Object.keys(PLATFORM_PERMISSIONS)}
          held={held}
          value={permissions}
          onChange={(next) => setPermissions(next as PlatformPermission[])}
        />
        {(save.error || remove.error) && (
          <FormMessage
            message={{
              text: (save.error ?? remove.error)!.message,
              kind: "err",
            }}
          />
        )}
        <DialogFooter>
          {role && (
            <ConfirmButton
              variant="destructive"
              className="mr-auto"
              title={`Delete the ${role.name} role?`}
              description="Only a role nobody holds can be deleted. This can't be undone."
              confirmLabel="Delete role"
              onConfirm={() => remove.mutate()}
            >
              Delete
            </ConfirmButton>
          )}
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The platform's activity log. */
export function ActivityPage() {
  return <AuditLog base="/admin/activity" />
}
