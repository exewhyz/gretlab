"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { ORG_TYPE, type OrgType } from "@/features/orgs/components/public"
import { slugify } from "@/features/problems/schemas"
import { api } from "@/lib/api/client"
import { formatDate } from "@/lib/format"

import { Card, Loading, PageTitle, Table } from "./shell"

interface OrgRow {
  id: string
  slug: string
  name: string
  type: OrgType
  active: boolean
  listed: boolean
  joinPolicy: string
  members: number
  createdAt: string
}

export function AdminOrganizations() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: "",
    slug: "",
    type: "college" as OrgType,
    ownerEmail: "",
  })
  const [slugTouched, setSlugTouched] = useState(false)
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const { data, error } = useQuery({
    queryKey: ["admin", "organizations"],
    queryFn: () => api<OrgRow[]>("/admin/organizations"),
  })
  const create = useMutation({
    mutationFn: () => api<OrgRow>("/admin/organizations", { body: form }),
    onSuccess: (org) => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "organizations"],
      })
      setMessage({
        text: `Created ${org.name}. Its owner manages it from /orgs/${org.slug}/manage.`,
        kind: "ok",
      })
      setForm({ name: "", slug: "", type: form.type, ownerEmail: "" })
      setSlugTouched(false)
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const toggle = useMutation({
    mutationFn: (org: OrgRow) =>
      api(`/admin/organizations/${org.id}`, {
        method: "PATCH",
        body: { active: !org.active },
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["admin", "organizations"],
      }),
  })
  if (!data) return <Loading error={error} />

  return (
    <>
      <PageTitle>Organizations</PageTitle>
      <Card className="mb-5 grid gap-3">
        <h2 className="text-title-sm text-ink">New organization</h2>
        <div className="grid gap-3 min-[901px]:grid-cols-4">
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                  slug: slugTouched
                    ? form.slug
                    : slugify(e.target.value).slice(0, 48),
                })
              }
            />
          </Field>
          <Field label="Address" help={`/orgs/${form.slug || "address"}`}>
            <TextInput
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true)
                setForm({ ...form, slug: e.target.value })
              }}
            />
          </Field>
          <Field label="Kind">
            <SelectInput
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as OrgType })
              }
            >
              {Object.entries(ORG_TYPE).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Owner's email" help="They manage it after signing in.">
            <TextInput
              type="email"
              value={form.ownerEmail}
              onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            Create organization
          </Button>
          <FormMessage message={message} />
        </div>
      </Card>
      <Table
        headers={["Organization", "Kind", "Members", "Joining", "Created", ""]}
      >
        {data.map((org) => (
          <tr key={org.id} className={org.active ? "" : "opacity-60"}>
            <td>
              <Link
                href={`/orgs/${org.slug}/manage`}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {org.name}
              </Link>
              {!org.active && <span className="ml-2 text-xs">Suspended</span>}
              {!org.listed && <span className="ml-2 text-xs">Unlisted</span>}
            </td>
            <td>{ORG_TYPE[org.type]}</td>
            <td className="tabular-nums">{org.members}</td>
            <td className="capitalize">{org.joinPolicy}</td>
            <td>{formatDate(org.createdAt)}</td>
            <td className="text-right">
              {org.active ? (
                <ConfirmButton
                  size="xs"
                  variant="ghost"
                  disabled={toggle.isPending}
                  title={`Suspend ${org.name}?`}
                  description="Nobody can join, and its members can't use its assignments, contests or management pages until you reactivate it. Nothing is deleted."
                  confirmLabel="Suspend"
                  onConfirm={() => toggle.mutate(org)}
                >
                  Suspend
                </ConfirmButton>
              ) : (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(org)}
                >
                  Reactivate
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {data.length === 0 && (
        <p className="mt-3 text-body-sm text-body">No organizations yet.</p>
      )}
    </>
  )
}
