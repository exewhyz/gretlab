"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { ConfirmButton } from "@/components/confirm"
import { Figure, Figures } from "@/components/figures"
import { Field, FormMessage, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Pager,
  Table,
} from "@/features/admin/components/shell"
import type {
  collegeAffiliation,
  universityColleges,
} from "@/features/university/affiliation"
import { ClassPrograms } from "@/features/university/components/class-programs"
import { CollegeRegistrations } from "@/features/university/components/registrations"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { useDebounced } from "@/lib/use-debounced"

type Mine = ApiResult<typeof collegeAffiliation>
type Colleges = ApiResult<typeof universityColleges>

const STATUS: Record<string, string> = {
  requested: "Waiting",
  active: "Affiliated",
  refused: "Refused",
  withdrawn: "Withdrawn",
  ended: "Ended",
}

/** A college's Manage › University: ask to affiliate, wait, or see who it's affiliated to. */
export function CollegeUniversity({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "university"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Mine>(`/orgs/${slug}/university`),
  })
  const [university, setUniversity] = useState("")
  const [note, setNote] = useState("")
  const ask = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/university`, { body: { university, note } }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
    meta: { success: "Asked.", quiet: true },
  })
  const leave = useMutation({
    mutationFn: () => api(`/orgs/${slug}/university`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
    meta: { success: "Done." },
  })
  if (!data) return <Loading error={error} />
  const now = data.current
  return (
    <div className="grid min-w-0 gap-6 [&>*]:min-w-0">
      <PageTitle>University</PageTitle>
      <Card>
        {now?.status === "active" ? (
          <div
            className="flex flex-wrap items-start justify-between gap-3"
            data-testid="affiliation-active"
          >
            <div>
              <p className="text-title-sm text-ink">
                Affiliated to {now.university.name}
              </p>
              <p className="text-body-sm text-body">
                College code{" "}
                <span className="font-mono text-ink">{now.collegeCode}</span>
                {now.decidedAt ? ` · since ${formatDate(now.decidedAt)}` : ""}
              </p>
              <p className="mt-2 max-w-[60ch] text-caption text-body">
                The university sets your syllabus, registers your students,
                holds the university exams and sees your students&apos;
                academics. It never sees your fees, parents, hostel, transport,
                leave or staff records.
              </p>
            </div>
            <ConfirmButton
              variant="outline"
              title={`Leave ${now.university.name}?`}
              description="The university stops seeing your students' academics at once. Its results already published stay on students' grade cards."
              confirmLabel="Leave the university"
              onConfirm={() => leave.mutate()}
            >
              Leave
            </ConfirmButton>
          </div>
        ) : now?.status === "requested" ? (
          <div
            className="flex flex-wrap items-start justify-between gap-3"
            data-testid="affiliation-waiting"
          >
            <div>
              <p className="text-title-sm text-ink">
                Waiting for {now.university.name}
              </p>
              <p className="text-body-sm text-body">
                Asked on {formatDate(now.requestedAt)}. The university approves
                it with your college code.
              </p>
            </div>
            <ConfirmButton
              variant="outline"
              title="Withdraw the request?"
              description="You can ask again later."
              confirmLabel="Withdraw"
              onConfirm={() => leave.mutate()}
            >
              Withdraw
            </ConfirmButton>
          </div>
        ) : (
          <form
            className="grid max-w-lg gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              ask.mutate()
            }}
          >
            <div>
              <p className="text-title-sm text-ink">
                Affiliate to a university
              </p>
              <p className="text-body-sm text-body">
                Enter the university&apos;s GretLab address. Once it approves,
                it sets your syllabus, registers your students and holds the
                university exams.
              </p>
            </div>
            <Field
              label="University's address"
              help="As in its link: /orgs/your-university"
            >
              <TextInput
                value={university}
                placeholder="your-university"
                onChange={(e) =>
                  setUniversity(e.target.value.toLowerCase().trim())
                }
              />
            </Field>
            <Field label="Note (optional)">
              <TextInput
                value={note}
                placeholder="Our affiliation letter number"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {ask.error && (
              <FormMessage message={{ text: ask.error.message, kind: "err" }} />
            )}
            <div>
              <Button
                type="submit"
                disabled={ask.isPending || university.length < 2}
              >
                Ask to affiliate
              </Button>
            </div>
          </form>
        )}
      </Card>
      {now?.status === "active" && <ClassPrograms slug={slug} />}
      {now?.status === "active" && <CollegeRegistrations slug={slug} />}
      {data.history.length > 0 && (
        <Card>
          <h2 className="mb-3 text-title-sm text-ink">Before</h2>
          <Table headers={["University", "Status", "Asked on", "Decided on"]}>
            {data.history.map((a) => (
              <tr key={a.id}>
                <td className="text-ink">{a.university.name}</td>
                <td>{STATUS[a.status] ?? a.status}</td>
                <td>{formatDate(a.requestedAt)}</td>
                <td>{a.decidedAt ? formatDate(a.decidedAt) : "—"}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  )
}

/** A university's Manage › Affiliated colleges: requests to decide, and its colleges. */
export function UniversityColleges({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"requested" | "active" | "">("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [approving, setApproving] = useState<Colleges["items"][number] | null>(
    null
  )
  const query = useDebounced(q)
  const client = useQueryClient()
  const key = ["org", slug, "colleges", status, query, page]
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<Colleges>(
        `/orgs/${slug}/colleges?page=${page}&q=${encodeURIComponent(query)}${status ? `&status=${status}` : ""}`
      ),
    placeholderData: keepPreviousData,
  })
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "refuse" | "end" }) =>
      api(`/orgs/${slug}/colleges/${id}`, { body: { action } }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["org", slug, "colleges"] }),
    meta: { success: "Done." },
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
      <PageTitle>Affiliated colleges</PageTitle>
      <Figures>
        <Figure label="Colleges" value={data.counts.active} />
        <Figure label="Waiting to decide" value={data.counts.requested} />
      </Figures>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Show" className="flex gap-1.5">
          {(
            [
              ["", "All"],
              ["requested", "Waiting"],
              ["active", "Affiliated"],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant={status === v ? "secondary" : "outline"}
              aria-pressed={status === v}
              onClick={() => {
                setStatus(v)
                setPage(1)
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="w-full sm:w-auto sm:max-w-xs sm:flex-1">
          <TextInput
            aria-label="Search colleges"
            placeholder="Name or college code"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>
      {data.items.length === 0 ? (
        <p className="text-body-sm text-body">
          {query
            ? "No college matches."
            : "No colleges yet. A college asks from its own Manage › University page."}
        </p>
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          <Table headers={["College", "Code", "Status", "Asked on", ""]}>
            {data.items.map((c) => (
              <tr key={c.id} data-testid="affiliated-college">
                <td>
                  <span className="text-ink">{c.college.name}</span>
                  {c.note && (
                    <span className="block text-caption text-body">
                      {c.note}
                    </span>
                  )}
                </td>
                <td className="font-mono text-ink">{c.collegeCode ?? "—"}</td>
                <td>
                  <Badge
                    variant={c.status === "requested" ? "outline" : "secondary"}
                  >
                    {STATUS[c.status] ?? c.status}
                  </Badge>
                </td>
                <td>{formatDate(c.requestedAt)}</td>
                <td className="text-right">
                  {data.can.decide && c.status === "requested" && (
                    <span className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Approve ${c.college.name}`}
                        onClick={() => setApproving(c)}
                      >
                        Approve
                      </Button>
                      <ConfirmButton
                        variant="ghost"
                        size="sm"
                        aria-label={`Refuse ${c.college.name}`}
                        title={`Refuse ${c.college.name}?`}
                        description="The college is told, and may ask again."
                        confirmLabel="Refuse"
                        onConfirm={() =>
                          decide.mutate({ id: c.id, action: "refuse" })
                        }
                      >
                        Refuse
                      </ConfirmButton>
                    </span>
                  )}
                  {data.can.decide && c.status === "active" && (
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      aria-label={`End ${c.college.name}'s affiliation`}
                      title={`End ${c.college.name}'s affiliation?`}
                      description="You stop seeing its students' academics at once. Results already published stay on students' grade cards."
                      confirmLabel="End affiliation"
                      onConfirm={() =>
                        decide.mutate({ id: c.id, action: "end" })
                      }
                    >
                      End
                    </ConfirmButton>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            page={data.page}
            pages={data.pages}
            total={data.total}
            perPage={50}
            onPage={setPage}
          />
        </div>
      )}
      {approving && (
        <ApproveDialog
          slug={slug}
          college={approving}
          onClose={() => setApproving(null)}
        />
      )}
    </div>
  )
}

function ApproveDialog({
  slug,
  college,
  onClose,
}: {
  slug: string
  college: Colleges["items"][number]
  onClose: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState("")
  const approve = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/colleges/${college.id}`, {
        body: { action: "approve", code },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug, "colleges"] })
      onClose()
    },
    meta: { success: "Approved.", quiet: true },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve {college.college.name}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            approve.mutate()
          }}
        >
          <Field
            label="College code"
            help="2 to 10 letters and digits; it starts the college's registration numbers."
          >
            <TextInput
              autoFocus
              value={code}
              placeholder="1RV"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
          {approve.error && (
            <FormMessage
              message={{ text: approve.error.message, kind: "err" }}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={approve.isPending || code.length < 2}
            >
              Approve
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
