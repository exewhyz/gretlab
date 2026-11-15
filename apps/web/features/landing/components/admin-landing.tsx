"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { ConfirmButton } from "@/components/confirm"
import { Field, SelectInput, TextArea, TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { Card, Loading, PageTitle, Pager, Stats, Table } from "@/features/admin/components/shell"
import { api, ApiRequestError } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { useDebounced } from "@/lib/use-debounced"

import type { landingProof, listEnquiries } from "../enquiries"
import { ENQUIRY_KINDS, PARTNER_KINDS } from "../schemas"

/*
 * Dashboard › Landing page: the enquiries sent from the landing page's form (for whoever
 * manages organizations), and the real partners and quotes the page shows (for whoever
 * manages the site's settings). Each tab appears only for the permission behind it.
 */

type Enquiries = ApiResult<typeof listEnquiries>
type Proof = ApiResult<typeof landingProof>

const KIND_LABEL: Record<string, string> = Object.fromEntries(ENQUIRY_KINDS.map((k) => [k.value, k.label]))

export function AdminLanding() {
  const { data: viewer, error } = useViewer()
  // The first tab depends on what this person may do, so wait until that's known.
  if (!viewer) return <Loading error={error} />
  const held = viewer.user?.platform.permissions ?? []
  const enquiries = held.includes("platform.orgs.manage")
  const proof = held.includes("platform.settings.manage")
  return (
    <>
      <PageTitle>Landing page</PageTitle>
      <p className="-mt-2 mb-5 max-w-[70ch] text-body-sm text-body">
        Requests from the landing page's form, and the institutions and quotes it shows. Add only
        real ones, with their permission; the sections stay hidden until there are some.
      </p>
      <Tabs defaultValue={enquiries ? "enquiries" : "partners"}>
        <TabsList>
          {enquiries && <TabsTrigger value="enquiries">Enquiries</TabsTrigger>}
          {proof && <TabsTrigger value="partners">Partners</TabsTrigger>}
          {proof && <TabsTrigger value="testimonials">Testimonials</TabsTrigger>}
        </TabsList>
        {enquiries && (
          <TabsContent value="enquiries" className="mt-4">
            <EnquiryList />
          </TabsContent>
        )}
        {proof && (
          <TabsContent value="partners" className="mt-4">
            <PartnerList />
          </TabsContent>
        )}
        {proof && (
          <TabsContent value="testimonials" className="mt-4">
            <TestimonialList />
          </TabsContent>
        )}
      </Tabs>
    </>
  )
}

function EnquiryList() {
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<"" | "new" | "handled">("new")
  const search = useDebounced(q)
  const params = new URLSearchParams({ page: String(page), perPage: "50", ...(search && { q: search }), ...(status && { status }) })
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ["landing-enquiries", page, search, status],
    queryFn: () => api<Enquiries>(`/admin/landing/enquiries?${params}`),
    placeholderData: keepPreviousData,
  })
  const mark = useMutation({
    mutationFn: ({ id, to }: { id: string; to: "new" | "handled" }) =>
      api(`/admin/landing/enquiries/${id}`, { method: "PATCH", body: { status: to } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["landing-enquiries"] }),
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <Stats items={[{ label: "New", value: data.waiting, tone: data.waiting > 0 ? "bad" : undefined }, { label: "Shown", value: data.total }]} />
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput
          aria-label="Search enquiries"
          placeholder="Search names, emails and organizations"
          className="w-72"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
        />
        <SelectInput
          aria-label="Status"
          className="w-40"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status)
            setPage(1)
          }}
        >
          <option value="new">New</option>
          <option value="handled">Handled</option>
          <option value="">All</option>
        </SelectInput>
      </div>
      {data.items.length === 0 ? (
        <Card>{status === "new" ? "No new enquiries." : "No enquiries here."}</Card>
      ) : (
        <div className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          <Table headers={["Organization", "From", "Kind", "Learners", "Message", "Sent", ""]}>
            {data.items.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className="font-medium">{e.organization}</span>
                  {e.status === "new" && (
                    <Badge variant="secondary" className="ml-2">
                      New
                    </Badge>
                  )}
                </td>
                <td>
                  {e.name}
                  <br />
                  <a href={`mailto:${e.email}`} className="text-caption text-body underline-offset-2 hover:underline">
                    {e.email}
                  </a>
                </td>
                <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                <td className="tabular-nums">{e.learners}</td>
                <td data-wrap className="max-w-[28rem] min-w-[16rem] text-body">
                  {e.message || <span className="text-muted-foreground">No message</span>}
                </td>
                <td className="tabular-nums">{new Date(e.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                <td>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mark.isPending}
                    onClick={() => mark.mutate({ id: e.id, to: e.status === "new" ? "handled" : "new" })}
                  >
                    {e.status === "new" ? "Mark handled" : "Mark new"}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      <Pager page={data.page} pages={data.pages} total={data.total} perPage={data.perPage} onPage={setPage} />
    </>
  )
}

function useProof() {
  return useQuery({
    queryKey: ["landing-proof"],
    queryFn: async () => {
      const [p, t] = await Promise.all([
        api<{ partners: Proof["partners"] }>("/admin/landing/partners"),
        api<{ testimonials: Proof["testimonials"] }>("/admin/landing/testimonials"),
      ])
      return { partners: p.partners, testimonials: t.testimonials }
    },
  })
}

function PartnerList() {
  const client = useQueryClient()
  const { data, error } = useProof()
  const [name, setName] = useState("")
  const [kind, setKind] = useState<(typeof PARTNER_KINDS)[number]>("college")
  const [message, setMessage] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const refresh = () => client.invalidateQueries({ queryKey: ["landing-proof"] })
  const add = useMutation({
    mutationFn: () => api("/admin/landing/partners", { body: { name, kind } }),
    onSuccess: () => {
      setName("")
      setMessage(null)
      setOpen(false)
      refresh()
    },
    onError: (e) => setMessage(e instanceof ApiRequestError ? e.message : "That didn't save."),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/landing/partners/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-4">
      <div>
        <Button onClick={() => setOpen(true)}>Add partner</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              add.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>Add a partner</DialogTitle>
              <DialogDescription>A real institution using GretLab, with its permission to be named.</DialogDescription>
            </DialogHeader>
            <Field label="Institution">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="As it should appear" />
            </Field>
            <Field label="Kind">
              <SelectInput value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="college">College</option>
                <option value="cohort">Cohort program</option>
                <option value="school">School</option>
                <option value="other">Other</option>
              </SelectInput>
            </Field>
            {message && <p className="text-caption text-destructive">{message}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={add.isPending || name.trim().length < 2}>
                Add partner
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {data.partners.length === 0 ? (
        <Card>None yet, so the landing page shows no partners.</Card>
      ) : (
        <Table headers={["Institution", "Kind", ""]}>
          {data.partners.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.name}</td>
              <td className="capitalize">{p.kind}</td>
              <td className="text-right">
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  title={`Take ${p.name} off the landing page?`}
                  description="It stops showing at once. You can add it again later."
                  confirmLabel="Remove"
                  tone="destructive"
                  onConfirm={() => remove.mutate(p.id)}
                >
                  Remove
                </ConfirmButton>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

function TestimonialList() {
  const client = useQueryClient()
  const { data, error } = useProof()
  const empty = { quote: "", name: "", role: "", institution: "" }
  const [form, setForm] = useState(empty)
  const [message, setMessage] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const refresh = () => client.invalidateQueries({ queryKey: ["landing-proof"] })
  const add = useMutation({
    mutationFn: () => api("/admin/landing/testimonials", { body: form }),
    onSuccess: () => {
      setForm(empty)
      setMessage(null)
      setOpen(false)
      refresh()
    },
    onError: (e) => setMessage(e instanceof ApiRequestError ? e.message : "That didn't save."),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/landing/testimonials/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-4">
      <div>
        <Button onClick={() => setOpen(true)}>Add testimonial</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate()
          }}
        >
          <DialogHeader className="sm:col-span-3">
            <DialogTitle>Add a testimonial</DialogTitle>
            <DialogDescription>Their exact words, with their permission to show them and their name.</DialogDescription>
          </DialogHeader>
          <div className="sm:col-span-3">
            <Field label="Quote">
              <TextArea rows={3} value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} placeholder="Their words, exactly, with their permission" />
            </Field>
          </div>
          <Field label="Name">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Role">
            <TextInput value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Head of CSE" />
          </Field>
          <Field label="Institution">
            <TextInput value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
          </Field>
          {message && <p className="text-caption text-destructive sm:col-span-3">{message}</p>}
          <DialogFooter className="sm:col-span-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={add.isPending}>
              Add testimonial
            </Button>
          </DialogFooter>
        </form>
        </DialogContent>
      </Dialog>
      {data.testimonials.length === 0 ? (
        <Card>None yet, so the landing page shows no quotes.</Card>
      ) : (
        <Table headers={["Quote", "Who", ""]}>
          {data.testimonials.map((t) => (
            <tr key={t.id}>
              <td data-wrap className="max-w-[36rem] min-w-[18rem]">
                “{t.quote}”
              </td>
              <td>
                {t.name}
                <br />
                <span className="text-caption text-body">
                  {t.role}, {t.institution}
                </span>
              </td>
              <td className="text-right">
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  title={`Take ${t.name}'s quote off the landing page?`}
                  description="It stops showing at once."
                  confirmLabel="Remove"
                  tone="destructive"
                  onConfirm={() => remove.mutate(t.id)}
                >
                  Remove
                </ConfirmButton>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}
