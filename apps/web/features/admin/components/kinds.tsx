"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { Button } from "@workspace/ui/components/button"
import { PERMISSIONS } from "@workspace/judge"

import { EditorSheet } from "@/components/editor-sheet"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { PermissionPicker } from "@/features/orgs/components/permission-picker"
import { api } from "@/lib/api/client"

import { Loading, PageTitle } from "./shell"

type Level = "off" | "optional" | "default"

interface Overview {
  modules: { key: string; label: string; description: string; ready: boolean }[]
  kinds: {
    key: string
    label: string
    description: string
    examples: string
    decides: string[]
    terms: Record<string, string | null>
    groupLevels: string[]
    organizations: number
    levels: Record<string, Level | null>
    roles: RoleTemplate[]
    rolesChanged: boolean
  }[]
}

interface RoleTemplate {
  key: string
  name: string
  description: string
  permissions: string[]
  scope: "organization" | "group"
}

const LEVELS: { value: Level; label: string }[] = [
  { value: "default", label: "On from the start" },
  { value: "optional", label: "Optional" },
  { value: "off", label: "Off" },
]

/**
 * Admin › Organization kinds: what each kind is, and which of the modules it can support
 * are off, optional (organizations switch them on) or on from the start. A change applies
 * to every organization of the kind at once.
 */
export function AdminKinds() {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["admin", "kinds"],
    queryFn: () => api<Overview>("/admin/kinds"),
  })
  const [picked, setPicked] = useState("school")
  const save = useMutation({
    mutationFn: (v: { kind: string; key: string; level: Level }) =>
      api<Overview>(`/admin/kinds/${v.kind}`, {
        method: "PUT",
        body: { modules: { [v.key]: v.level } },
      }),
    onSuccess: (next) => client.setQueryData(["admin", "kinds"], next),
  })
  if (!data) return <Loading error={error} />
  const kind = data.kinds.find((k) => k.key === picked) ?? data.kinds[0]!
  const t = kind.terms
  return (
    <div className="grid gap-5" data-testid="admin-kinds">
      <div>
        <PageTitle>Organization kinds</PageTitle>
        <p className="-mt-2 max-w-3xl text-body-sm text-muted-foreground">
          Each organization is one kind, chosen when it&apos;s created and never
          changed. The kind decides its structure and words; here you decide
          which modules each kind gets. A change applies to every organization
          of that kind at once; organizations can still switch optional ones on
          or off.
        </p>
      </div>
      <Tabs value={kind.key} onValueChange={(v) => setPicked(String(v))}>
        <TabsList className="flex-wrap">
          {data.kinds.map((k) => (
            <TabsTrigger key={k.key} value={k.key}>
              {k.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-title-md">{kind.label}</CardTitle>
            <CardDescription>{kind.description}</CardDescription>
            <CardAction>
              <Badge variant="secondary" data-testid="kind-orgs">
                {kind.organizations} organization
                {kind.organizations === 1 ? "" : "s"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4 text-body-sm">
            <div className="text-muted-foreground">
              For example: {kind.examples}
            </div>
            <ul className="grid list-disc gap-1 pl-5 text-body">
              {kind.decides.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <dl
              className="grid grid-cols-2 gap-x-4 gap-y-2"
              data-testid="kind-terms"
            >
              {(
                [
                  ["Learners", t.learners],
                  ["Instructors", t.instructors],
                  ["Groups", `${t.groups} (${kind.groupLevels.join(" › ")})`],
                  ["Led by", t.groupLead],
                  ["Organized by", t.period],
                  ["Assessments", t.assessments],
                  ["Guardians", t.guardians ?? "None"],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-caption text-muted-foreground">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card className="pb-0">
          <CardHeader>
            <CardTitle className="text-title-md">Modules</CardTitle>
            <CardDescription>
              What a {kind.label.toLowerCase()} can have. Modules it can&apos;t
              support aren&apos;t offered.
            </CardDescription>
          </CardHeader>
          {save.error && (
            <div className="px-6">
              <FormMessage
                message={{ text: save.error.message, kind: "err" }}
              />
            </div>
          )}
          <Table data-testid="kind-modules">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Module</TableHead>
                <TableHead className="w-52 pr-6">
                  For a {kind.label.toLowerCase()}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.modules.map((m) => {
                const level = kind.levels[m.key]
                return (
                  <TableRow key={m.key} data-testid="kind-module">
                    <TableCell className="pl-6 whitespace-normal">
                      <div className="font-medium text-ink">
                        {m.label}
                        {!m.ready && (
                          <Badge variant="outline" className="ml-2">
                            Coming soon
                          </Badge>
                        )}
                      </div>
                      <div className="text-caption text-muted-foreground">
                        {m.description}
                      </div>
                    </TableCell>
                    <TableCell className="pr-6">
                      {level == null ? (
                        <span className="text-caption text-muted-foreground">
                          Not for this kind
                        </span>
                      ) : (
                        <SelectInput
                          aria-label={`${m.label} for ${kind.label}`}
                          value={level}
                          disabled={save.isPending}
                          onChange={(e) =>
                            save.mutate({
                              kind: kind.key,
                              key: m.key,
                              level: e.target.value as Level,
                            })
                          }
                        >
                          {LEVELS.map((l) => (
                            <option key={l.value} value={l.value}>
                              {l.label}
                            </option>
                          ))}
                        </SelectInput>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      </div>
      <KindRoles
        kind={kind.key}
        label={kind.label}
        roles={kind.roles}
        changed={kind.rolesChanged}
        onSaved={(next) => client.setQueryData(["admin", "kinds"], next)}
      />
    </div>
  )
}

/**
 * A kind's suggested roles: new organizations of the kind start with them, and existing
 * ones are offered those they don't have. Add, edit, delete, or go back to the default.
 */
function KindRoles({
  kind,
  label,
  roles,
  changed,
  onSaved,
}: {
  kind: string
  label: string
  roles: RoleTemplate[]
  changed: boolean
  onSaved: (next: Overview) => void
}) {
  const [editing, setEditing] = useState<RoleTemplate | "new" | null>(null)
  const save = useMutation({
    mutationFn: (next: RoleTemplate[] | null) =>
      api<Overview>(`/admin/kinds/${kind}/roles`, { method: "PUT", body: { roles: next } }),
    onSuccess: (next) => {
      onSaved(next)
      setEditing(null)
    },
  })
  const lower = label.toLowerCase()
  return (
    <Card className="pb-0" data-testid="kind-roles">
      <CardHeader>
        <CardTitle className="text-title-md">Suggested roles</CardTitle>
        <CardDescription>
          A new {lower} starts with these, beside the built-in ones; existing ones are offered
          those they don&apos;t have. Each {lower} can change or delete its own copies.
        </CardDescription>
        <CardAction className="flex gap-2">
          {changed && (
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>
              Use the default list
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing("new")}>
            Add role
          </Button>
        </CardAction>
      </CardHeader>
      {save.error && (
        <div className="px-6">
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        </div>
      )}
      {editing && (
          <TemplateEditor
            role={editing === "new" ? null : editing}
            busy={save.isPending}
            onCancel={() => setEditing(null)}
            onSave={(r) =>
              save.mutate(
                editing === "new" ? [...roles, r] : roles.map((x) => (x.key === editing.key ? r : x))
              )
            }
          />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">Role</TableHead>
            <TableHead>Given</TableHead>
            <TableHead>Permissions</TableHead>
            <TableHead className="pr-6" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((r) => (
            <TableRow key={r.key} data-testid="kind-role">
              <TableCell className="pl-6 whitespace-normal">
                <div className="font-medium text-ink">{r.name}</div>
                <div className="max-w-md text-caption text-muted-foreground">{r.description}</div>
              </TableCell>
              <TableCell>{r.scope === "group" ? "Within a group" : "Organization-wide"}</TableCell>
              <TableCell>{r.permissions.length}</TableCell>
              <TableCell className="pr-6 text-right">
                <Button size="xs" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={save.isPending}
                  aria-label={`Remove ${r.name}`}
                  onClick={() => save.mutate(roles.filter((x) => x.key !== r.key))}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {roles.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="pl-6 text-muted-foreground">
                None: a new {lower} starts with the built-in roles only.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

function TemplateEditor({
  role,
  busy,
  onCancel,
  onSave,
}: {
  role: RoleTemplate | null
  busy: boolean
  onCancel: () => void
  onSave: (r: RoleTemplate) => void
}) {
  const [name, setName] = useState(role?.name ?? "")
  const [description, setDescription] = useState(role?.description ?? "")
  const [scope, setScope] = useState<RoleTemplate["scope"]>(role?.scope ?? "organization")
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? [])
  const key =
    role?.key ??
    (name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "role")
  const submit = () =>
    onSave({ key: key.length < 2 ? `${key}_role` : key, name, description, scope, permissions })
  return (
    <EditorSheet
      title={role ? `Edit ${role.name}` : "Add a suggested role"}
      description="Organizations of this kind start with it; it's theirs to change."
      submitLabel={role ? "Save role" : "Add role"}
      submitDisabled={busy || !name.trim()}
      onSubmit={submit}
      onClose={onCancel}
      testId="template-editor"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <Field label="Role name">
          <TextInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Given">
          <SelectInput value={scope} onChange={(e) => setScope(e.target.value as RoleTemplate["scope"])}>
            <option value="organization">Organization-wide</option>
            <option value="group">Within a group</option>
          </SelectInput>
        </Field>
      </div>
      <Field label="What it's for">
        <TextInput value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <PermissionPicker
        catalog={PERMISSIONS}
        order={Object.keys(PERMISSIONS)}
        held={null}
        value={permissions}
        onChange={setPermissions}
      />
    </EditorSheet>
  )
}
