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
import { Checkbox } from "@workspace/ui/components/checkbox"

import { ConfirmButton } from "@/components/confirm"
import { Figure, Figures } from "@/components/figures"
import { FormMessage, SelectInput, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Pager,
  Table,
} from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import type {
  collegeRegistrations,
  universityRegistrationList,
} from "@/features/university/registrations"
import type { collegePrograms } from "@/features/university/syllabus"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { useDebounced } from "@/lib/use-debounced"

type Mine = ApiResult<typeof collegeRegistrations>
type Theirs = ApiResult<typeof universityRegistrationList>
type Classes = ApiResult<typeof collegePrograms>

const STATUS: Record<string, string> = {
  requested: "Waiting",
  approved: "Registered",
  rejected: "Rejected",
  cancelled: "Cancelled",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "approved" ? "secondary" : "outline"}>
      {STATUS[status] ?? status}
    </Badge>
  )
}

function StatusFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
      {(
        [
          ["", "All"],
          ["requested", "Waiting"],
          ["approved", "Registered"],
          ["rejected", "Rejected"],
        ] as const
      ).map(([v, label]) => (
        <Button
          key={v}
          size="sm"
          variant={value === v ? "secondary" : "outline"}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

/** A college's registrations with its university, on Manage › University. */
export function CollegeRegistrations({ slug }: { slug: string }) {
  const client = useQueryClient()
  const [status, setStatus] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const query = useDebounced(q)
  const key = ["org", slug, "university", "registrations"]
  const { data, isPlaceholderData } = useQuery({
    queryKey: [...key, status, query, page],
    queryFn: () =>
      api<Mine>(
        `/orgs/${slug}/university/registrations?page=${page}&q=${encodeURIComponent(query)}${status ? `&status=${status}` : ""}`
      ),
    placeholderData: keepPreviousData,
    throwOnError: false,
    retry: false,
  })
  const classes = useQuery({
    queryKey: ["org", slug, "university", "classes"],
    queryFn: () => api<Classes>(`/orgs/${slug}/university/classes`),
    throwOnError: false,
    retry: false,
  })
  const [groupId, setGroupId] = useState("")
  const [programId, setProgramId] = useState("")
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const register = useMutation({
    mutationFn: () =>
      api<{ registered: number; alreadyRegistered: number; skipped: number }>(
        `/orgs/${slug}/university/registrations`,
        { body: { groupId, programId, admissionYear: Number(year) } }
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
    meta: { quiet: true },
  })
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/university/registrations/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
    meta: { success: "Cancelled." },
  })
  if (!data?.university) return null
  const r = register.data
  return (
    <Card>
      <h2 className="text-title-sm text-ink">
        Registration with the university
      </h2>
      <p className="mb-3 max-w-[65ch] text-body-sm text-body">
        Register a class&apos;s students for a program and their admission year.
        The university approves each and gives them a registration number. Only
        students with a student record are registered.
      </p>
      <Figures>
        <Figure label="Registered" value={data.counts.approved} />
        <Figure
          label="Waiting for the university"
          value={data.counts.requested}
        />
      </Figures>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_7rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          register.mutate()
        }}
      >
        <GroupPicker
          label="Class to register"
          groups={classes.data?.groups ?? []}
          levels={classes.data?.levels ?? []}
          value={groupId}
          onChange={setGroupId}
          placeholder="Choose a class"
        />
        <SelectInput
          aria-label="Program"
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
        >
          <option value="">Program…</option>
          {data.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.path}
            </option>
          ))}
        </SelectInput>
        <TextInput
          type="number"
          aria-label="Admission year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <Button
          type="submit"
          disabled={!groupId || !programId || !year || register.isPending}
        >
          Register
        </Button>
        {register.error && (
          <div className="sm:col-span-4">
            <FormMessage
              message={{ text: register.error.message, kind: "err" }}
            />
          </div>
        )}
        {r && (
          <p
            className="text-body-sm text-body sm:col-span-4"
            data-testid="register-result"
          >
            {r.registered} registered
            {r.alreadyRegistered > 0 && `, ${r.alreadyRegistered} already were`}
            {r.skipped > 0 &&
              `, ${r.skipped} without a student record left out`}
            .
          </p>
        )}
      </form>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <StatusFilter
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        />
        <div className="w-full sm:w-64">
          <TextInput
            aria-label="Search registrations"
            placeholder="Name or number"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>
      {data.items.length === 0 ? (
        <p className="mt-3 text-body-sm text-body">
          No registrations here yet.
        </p>
      ) : (
        <div className={`mt-3 ${isPlaceholderData ? "opacity-60" : ""}`}>
          <Table
            headers={["Student", "Program", "Year", "Status", "Number", ""]}
          >
            {data.items.map((row) => (
              <tr key={row.id} data-testid="college-registration">
                <td>
                  <span className="text-ink">{row.student}</span>
                  {row.admissionNo && (
                    <span className="block text-caption">
                      {row.admissionNo}
                    </span>
                  )}
                </td>
                <td>{row.program}</td>
                <td className="tabular-nums">{row.admissionYear}</td>
                <td>
                  <StatusBadge status={row.status} />
                  {row.note && (
                    <span className="block text-caption">{row.note}</span>
                  )}
                </td>
                <td className="font-mono text-ink">{row.regNo ?? "—"}</td>
                <td className="text-right">
                  {row.status === "requested" && (
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      aria-label={`Cancel ${row.student}'s registration`}
                      title={`Cancel ${row.student}'s registration?`}
                      description="You can register them again later."
                      confirmLabel="Cancel registration"
                      onConfirm={() => cancel.mutate(row.id)}
                    >
                      Cancel
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
            perPage={data.perPage}
            onPage={setPage}
          />
        </div>
      )}
    </Card>
  )
}

/** A university's Manage › Registrations: approve or reject what its colleges registered. */
export function UniversityRegistrations({ slug }: { slug: string }) {
  const client = useQueryClient()
  const [status, setStatus] = useState("requested")
  const [college, setCollege] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const query = useDebounced(q)
  const key = ["org", slug, "registrations"]
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: [...key, status, college, query, page],
    queryFn: () =>
      api<Theirs>(
        `/orgs/${slug}/registrations?page=${page}&q=${encodeURIComponent(query)}${status ? `&status=${status}` : ""}${college ? `&college=${college}` : ""}`
      ),
    placeholderData: keepPreviousData,
  })
  const decide = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      api<{ decided: number }>(`/orgs/${slug}/registrations/decide`, {
        body: { ids: [...picked], action },
      }),
    onSuccess: (r, action) => {
      setPicked(new Set())
      void client.invalidateQueries({ queryKey: key })
      return r && action
    },
    meta: { success: "Done." },
  })
  if (!data) return <Loading error={error} />
  const waiting = data.items.filter((r) => r.status === "requested")
  const all = waiting.length > 0 && waiting.every((r) => picked.has(r.id))
  const reset = () => {
    setPage(1)
    setPicked(new Set())
  }
  return (
    <div className="grid min-w-0 gap-4 *:min-w-0">
      <PageTitle>Registrations</PageTitle>
      <Figures>
        <Figure label="Registered" value={data.counts.approved} />
        <Figure label="Waiting to decide" value={data.counts.requested} />
        <Figure label="Colleges" value={data.colleges.length} />
      </Figures>
      <div className="flex flex-wrap items-center gap-3">
        <StatusFilter
          value={status}
          onChange={(v) => {
            setStatus(v)
            reset()
          }}
        />
        <SelectInput
          aria-label="College"
          className="w-full sm:w-64"
          value={college}
          onChange={(e) => {
            setCollege(e.target.value)
            reset()
          }}
        >
          <option value="">Every college</option>
          {data.colleges.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} · ` : ""}
              {c.name}
            </option>
          ))}
        </SelectInput>
        <div className="w-full sm:w-64">
          <TextInput
            aria-label="Search registrations"
            placeholder="Name or number"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              reset()
            }}
          />
        </div>
      </div>
      {data.can.decide && picked.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-card p-2 text-body-sm"
          data-testid="registrations-bulk"
        >
          <span className="text-ink">{picked.size} selected</span>
          <Button
            size="sm"
            disabled={decide.isPending}
            onClick={() => decide.mutate("approve")}
          >
            Approve and number
          </Button>
          <ConfirmButton
            size="sm"
            variant="outline"
            title={`Reject ${picked.size} ${picked.size === 1 ? "registration" : "registrations"}?`}
            description="Their colleges are told and can register them again."
            confirmLabel="Reject"
            onConfirm={() => decide.mutate("reject")}
          >
            Reject
          </ConfirmButton>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPicked(new Set())}
          >
            Clear
          </Button>
        </div>
      )}
      {data.items.length === 0 ? (
        <p className="text-body-sm text-body">
          {status === "requested"
            ? "Nothing waiting to decide."
            : "Nothing here."}
        </p>
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          {data.can.decide && waiting.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="mb-2"
              onClick={() =>
                setPicked(all ? new Set() : new Set(waiting.map((r) => r.id)))
              }
            >
              {all
                ? "Clear the selection"
                : `Select the ${waiting.length} waiting on this page`}
            </Button>
          )}
          <Table
            headers={[
              "",
              "Student",
              "College",
              "Program",
              "Year",
              "Status",
              "Number",
            ]}
          >
            {data.items.map((row) => (
              <tr key={row.id} data-testid="university-registration">
                <td className="w-8">
                  {data.can.decide && row.status === "requested" && (
                    <Checkbox
                      aria-label={`Select ${row.student}`}
                      checked={picked.has(row.id)}
                      onCheckedChange={(checked) =>
                        setPicked((p) => {
                          const next = new Set(p)
                          if (checked) next.add(row.id)
                          else next.delete(row.id)
                          return next
                        })
                      }
                    />
                  )}
                </td>
                <td>
                  <span className="text-ink">{row.student}</span>
                  {row.admissionNo && (
                    <span className="block text-caption">
                      {row.admissionNo}
                    </span>
                  )}
                </td>
                <td>{row.college}</td>
                <td>{row.program}</td>
                <td className="tabular-nums">{row.admissionYear}</td>
                <td>
                  <StatusBadge status={row.status} />
                  <span className="block text-caption">
                    {formatDate(row.requestedAt)}
                  </span>
                </td>
                <td className="font-mono text-ink">{row.regNo ?? "—"}</td>
              </tr>
            ))}
          </Table>
          <Pager
            page={data.page}
            pages={data.pages}
            total={data.total}
            perPage={data.perPage}
            onPage={(p) => {
              setPage(p)
              setPicked(new Set())
            }}
          />
        </div>
      )}
    </div>
  )
}
