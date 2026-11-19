"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Progress } from "@workspace/ui/components/progress"

import { Field, TextInput } from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDate, formatDay } from "@/lib/format"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import { toast } from "@/lib/toast"
import type { memberProfile } from "@/features/profile/server"
import { memberProfileSchema } from "@/features/profile/schemas"

type Profile = ApiResult<typeof memberProfile>

/** Someone's profile in one organization: who they are here and who's linked to them. */
export function MemberProfile({ slug, id }: { slug: string; id: string }) {
  const key = ["org", slug, "profile", id]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Profile>(`/orgs/${slug}/profile/${id}`),
  })
  const [editing, setEditing] = useState(false)
  if (!data) return <Loading error={error} />
  const p = data
  const pages = orgPages(slug)
  const kinds = [
    p.kinds.staff && "Staff",
    p.kinds.student && "Student",
    p.kinds.parent && "Parent",
  ].filter(Boolean) as string[]
  const percent = Math.round(
    (p.completeness.done / p.completeness.total) * 100
  )

  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap gap-2">
            {p.me && (
              <Link
                href="/account"
                className="inline-flex h-8 items-center rounded-md border border-hairline px-3 text-body-sm text-ink hover:bg-muted"
              >
                Edit account profile
              </Link>
            )}
            {p.can.edit && p.kinds.staff && (
              <Button size="sm" onClick={() => setEditing(true)}>
                {p.me ? "Edit my details here" : "Edit details"}
              </Button>
            )}
          </div>
        }
      >
        {p.name}
      </PageTitle>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-body-sm text-body">
        {kinds.map((k) => (
          <Badge key={k} variant="secondary">
            {k}
          </Badge>
        ))}
        {p.about.headline && <span>{p.about.headline}</span>}
        {p.membership && (
          <span className="text-caption">
            Member since {formatDate(p.membership.since)}
          </span>
        )}
      </div>

      <div className="grid gap-4 min-[1024px]:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-4">
          {(p.roles.length > 0 || p.groups.length > 0) && (
            <Section title="Here">
              {p.roles.length > 0 && (
                <Facts>
                  {p.roles.map((r, i) => (
                    <Fact key={`${r.name}-${i}`} label={r.name}>
                      {r.where}
                    </Fact>
                  ))}
                </Facts>
              )}
              {p.groups.length > 0 && (
                <div className="grid gap-1">
                  <span className="text-caption text-body">Sits in</span>
                  <div className="flex flex-wrap gap-1.5">
                    {p.groups.map((g) => (
                      <Badge key={g.id} variant="outline">
                        {g.path}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {p.kinds.staff && (
            <Section title="Staff details" testId="staff-details">
              <Facts>
                <Fact label="Designation">{p.details.designation}</Fact>
                <Fact label="Department">{p.details.department}</Fact>
                <Fact label="Staff number">{p.details.employeeId}</Fact>
                <Fact label="Joined the staff">
                  {p.details.joinedOn && formatDay(p.details.joinedOn)}
                </Fact>
                {p.details.phone && (
                  <Fact label="Work phone">{p.details.phone}</Fact>
                )}
              </Facts>
            </Section>
          )}

          {(p.teaching.subjects.length > 0 ||
            p.teaching.classTeacherOf.length > 0 ||
            p.teaching.leads.length > 0) && (
            <Section title="Teaching">
              <Facts>
                {p.teaching.classTeacherOf.map((c) => (
                  <Fact key={`ct-${c.group}`} label="Class teacher">
                    {c.group} ({c.year})
                  </Fact>
                ))}
                {p.teaching.leads.map((g) => (
                  <Fact key={`lead-${g}`} label="Leads">
                    {g}
                  </Fact>
                ))}
                {p.teaching.subjects.map((s, i) => (
                  <Fact key={`s-${i}`} label={s.subject}>
                    {s.group}
                  </Fact>
                ))}
              </Facts>
            </Section>
          )}

          {p.record && (
            <Section title="Student record" testId="student-record">
              <Facts>
                <Fact label="Admission number">{p.record.admissionNo}</Fact>
                {p.record.current && (
                  <>
                    <Fact label="Class">{p.record.current.group}</Fact>
                    <Fact label="Roll number">
                      {p.record.current.rollNo ?? ""}
                    </Fact>
                    <Fact label="Year">{p.record.current.year}</Fact>
                  </>
                )}
                <Fact label="Gender">
                  {p.record.gender &&
                    p.record.gender[0]!.toUpperCase() + p.record.gender.slice(1)}
                </Fact>
                <Fact label="Date of birth">
                  {p.record.birthDate && formatDay(p.record.birthDate)}
                </Fact>
                <Fact label="Phone">{p.record.phone}</Fact>
                <Fact label="Address">{p.record.address}</Fact>
                <Fact label="Admitted">
                  {p.record.admittedOn && formatDay(p.record.admittedOn)}
                </Fact>
              </Facts>
              {p.me && (
                <p className="text-caption text-body">
                  Your record is kept by the office. Ask them to correct
                  anything that&apos;s wrong.
                </p>
              )}
            </Section>
          )}

          {(p.about.bio ||
            p.about.city ||
            p.about.website ||
            p.about.github ||
            p.about.linkedin ||
            p.about.phone ||
            p.email) && (
            <Section title="About">
              {p.about.bio && (
                <p className="whitespace-pre-line text-body-sm text-ink">
                  {p.about.bio}
                </p>
              )}
              <Facts>
                {p.email && <Fact label="Email">{p.email}</Fact>}
                {p.about.phone && <Fact label="Phone">{p.about.phone}</Fact>}
                {p.about.city && <Fact label="City">{p.about.city}</Fact>}
                {p.about.website && (
                  <Fact label="Website">
                    <ExternalLink href={p.about.website} />
                  </Fact>
                )}
                {p.about.github && (
                  <Fact label="GitHub">
                    <ExternalLink
                      href={`https://github.com/${p.about.github}`}
                      text={p.about.github}
                    />
                  </Fact>
                )}
                {p.about.linkedin && (
                  <Fact label="LinkedIn">
                    <ExternalLink href={p.about.linkedin} />
                  </Fact>
                )}
              </Facts>
            </Section>
          )}
        </div>

        <aside className="grid content-start gap-4">
          {p.me && p.completeness.missing.length > 0 && (
            <Section title="Complete your profile" testId="member-completeness">
              <div className="flex items-baseline justify-between text-caption text-body">
                <span>
                  {p.completeness.done} of {p.completeness.total} done
                </span>
              </div>
              <Progress value={percent} aria-label="Profile complete" />
              <ul className="grid gap-1 text-body-sm text-body">
                {p.completeness.missing.map((m) => (
                  <li key={m.key}>· {m.label}</li>
                ))}
              </ul>
            </Section>
          )}

          {p.parents.length > 0 && (
            <Section title="Parents" testId="profile-parents">
              <ul className="grid gap-2">
                {p.parents.map((parent) => (
                  <li key={parent.id} className="text-body-sm">
                    <Link
                      href={pages.profile(parent.id)}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {parent.name}
                    </Link>
                    {parent.relation && (
                      <span className="text-body"> · {parent.relation}</span>
                    )}
                    {parent.email && (
                      <span className="block text-caption text-body">
                        {parent.email}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {p.children.length > 0 && (
            <Section title="Children" testId="profile-children">
              <ul className="grid gap-2">
                {p.children.map((child) => (
                  <li key={child.id} className="text-body-sm">
                    <Link
                      href={p.me ? pages.child(child.id) : pages.profile(child.id)}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {child.name}
                    </Link>
                    {child.relation && (
                      <span className="text-body"> · {child.relation}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </aside>
      </div>

      {editing && (
        <EditDetails
          slug={slug}
          id={id}
          profile={p}
          queryKey={key}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}

function Section({
  title,
  children,
  testId,
}: {
  title: string
  children: ReactNode
  testId?: string
}) {
  return (
    <section
      className="grid gap-3 rounded-lg border border-hairline bg-card p-4"
      data-testid={testId}
    >
      <h2 className="text-title-sm text-ink">{title}</h2>
      {children}
    </section>
  )
}

function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 min-[640px]:grid-cols-[12rem_1fr]">
      {children}
    </dl>
  )
}

/** One label and value; an empty value says so rather than leaving a gap. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  const empty =
    children === "" || children === null || children === undefined || children === false
  return (
    <>
      <dt className="text-caption text-body">{label}</dt>
      <dd className={empty ? "text-body-sm text-muted-foreground" : "text-body-sm text-ink"}>
        {empty ? "Not given" : children}
      </dd>
    </>
  )
}

function ExternalLink({ href, text }: { href: string; text?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="break-all text-ink underline underline-offset-2"
    >
      {text ?? href.replace(/^https?:\/\//, "")}
    </a>
  )
}

function EditDetails({
  slug,
  id,
  profile,
  queryKey,
  onClose,
}: {
  slug: string
  id: string
  profile: Profile
  queryKey: unknown[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    designation: profile.details.designation,
    department: profile.details.department,
    employeeId: profile.details.employeeId,
    joinedOn: profile.details.joinedOn,
    phone: profile.details.phone,
  })
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const { employeeId, ...rest } = form
      return api<Profile>(`/orgs/${slug}/profile/${id}`, {
        method: "PATCH",
        body: profile.can.editStaffNumber ? form : rest,
      })
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next)
      toast.success("Details saved")
      onClose()
    },
    onError: (e) => setError(e.message),
  })
  const submit = () => {
    const parsed = memberProfileSchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details.")
      return
    }
    save.mutate()
  }
  const field = (
    key: keyof typeof form,
    label: string,
    props: { type?: string; help?: string; disabled?: boolean } = {}
  ) => (
    <Field label={label} help={props.help}>
      <TextInput
        type={props.type ?? "text"}
        value={form[key]}
        disabled={props.disabled}
        onChange={(e) => {
          setForm((f) => ({ ...f, [key]: e.target.value }))
          setError(null)
        }}
      />
    </Field>
  )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {profile.me ? "Your details here" : `${profile.name}'s details`}
          </DialogTitle>
          <DialogDescription>
            Kept by this organization, beside your account profile. The phone
            is sealed and shown only to its staff who may see members.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 min-[560px]:grid-cols-2">
            {field("designation", "Designation")}
            {field("department", "Department")}
          </div>
          <div className="grid gap-3 min-[560px]:grid-cols-2">
            {field("employeeId", "Staff number", {
              disabled: !profile.can.editStaffNumber,
              help: profile.can.editStaffNumber
                ? undefined
                : "Set by the office.",
            })}
            {field("joinedOn", "Joined the staff", { type: "date" })}
          </div>
          {field("phone", "Work phone", { type: "tel" })}
          {error && (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save details"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
