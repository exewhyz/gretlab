"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextInput } from "@/components/form"
import { ORG_TYPE, type OrgType } from "@/features/orgs/components/public"
import { slugify } from "@/features/problems/schemas"
import { api } from "@/lib/api/client"
import { useDebounced } from "@/lib/use-debounced"
import { formatDate } from "@/lib/format"
import { KindPicker } from "@/features/orgs/components/kind-picker"

import { Card, Loading, PageTitle, Pager, Table } from "./shell"
import { orgPages } from "@/lib/paths"

interface OrgRow {
  id: string
  slug: string
  name: string
  type: OrgType
  active: boolean
  signupStatus: string | null
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
  const [kindConfirmed, setKindConfirmed] = useState(false)
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  // The server is asked once typing pauses.
  const asked = useDebounced(search.trim())
  const {
    data: found,
    error,
    isPlaceholderData,
  } = useQuery({
    queryKey: ["admin", "organizations", asked, page],
    queryFn: () =>
      api<{
        organizations: OrgRow[]
        total: number
        page: number
        pages: number
      }>(
        `/admin/organizations?${new URLSearchParams({ q: asked, page: String(page) })}`
      ),
    placeholderData: keepPreviousData,
  })
  const data = found?.organizations
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
      setKindConfirmed(false)
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
        <div className="grid gap-3 min-[901px]:grid-cols-3">
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
          <Field label="Owner's email" help="They manage it after signing in.">
            <TextInput
              type="email"
              value={form.ownerEmail}
              onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            />
          </Field>
        </div>
        <KindPicker
          value={form.type}
          onChange={(type) => setForm({ ...form, type })}
          confirmed={kindConfirmed}
          onConfirm={setKindConfirmed}
        />
        <div className="flex items-center gap-3">
          <Button
            disabled={create.isPending || !kindConfirmed}
            onClick={() => create.mutate()}
          >
            Create organization
          </Button>
          <FormMessage message={message} />
        </div>
      </Card>
      <div className="mb-3 max-w-sm">
        <TextInput
          aria-label="Search organizations"
          placeholder="Search by name or address"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>
      <div className={isPlaceholderData ? "opacity-60" : undefined}>
        <Table
          headers={[
            "Organization",
            "Kind",
            "Members",
            "Joining",
            "Created",
            "",
          ]}
        >
          {data.map((org) => (
            <tr key={org.id} className={org.active ? "" : "opacity-60"}>
              <td>
                <Link
                  href={orgPages(org.slug).home}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {org.name}
                </Link>
                {org.signupStatus === "pending" ? (
                  <span
                    className="ml-2 text-xs font-semibold text-primary-active"
                    data-testid="awaiting-approval"
                  >
                    Waiting for approval
                  </span>
                ) : (
                  !org.active && <span className="ml-2 text-xs">Suspended</span>
                )}
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
                    variant={
                      org.signupStatus === "pending" ? "default" : "ghost"
                    }
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(org)}
                  >
                    {org.signupStatus === "pending" ? "Approve" : "Reactivate"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </div>
      {found && (
        <Pager
          page={found.page}
          pages={found.pages}
          total={found.total}
          perPage={50}
          onPage={setPage}
        />
      )}
      {data.length === 0 && (
        <p className="mt-3 text-body-sm text-body">
          {search ? "No organization matches." : "No organizations yet."}
        </p>
      )}
    </>
  )
}
