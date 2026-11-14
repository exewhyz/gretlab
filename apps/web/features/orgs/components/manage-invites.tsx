"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { ConfirmButton } from "@/components/confirm"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

import { GroupPicker } from "./group-picker"
import { formatDateTime } from "@/lib/format"

import { useGroups, useRoles } from "./manage-shared"
import type { listInvites } from "@/features/orgs/server"

export type Invite = ApiResult<typeof listInvites>[number]

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

export function RevokeInvite({
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
