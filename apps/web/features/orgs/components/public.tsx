"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Checkbox } from "@workspace/ui/components/checkbox"

import { ConfirmButton } from "@/components/confirm"
import { FormMessage, TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { ORG_TYPE_CONFIG, ORG_TYPES, type OrgType } from "@workspace/judge"

import { Loading } from "@/features/admin/components/shell"
import { ApplyButton } from "@/features/admissions/components/admissions"
import { SignupLink } from "@/features/orgs/components/signup"
import { api } from "@/lib/api/client"
import { formatDate, formatDateTime } from "@/lib/format"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type {
  getInvite,
  getOrganization,
  listDirectory,
  myOrganizations,
} from "@/features/orgs/server"
import type { orgFeed } from "@/features/orgs/content"
import type { classesToRate } from "@/features/teaching/server"

export type { OrgType } from "@workspace/judge"

/** Each kind of organization's display name, from the shared type config. */
export const ORG_TYPE = Object.fromEntries(
  ORG_TYPES.map((t) => [t, ORG_TYPE_CONFIG[t].label])
) as Record<OrgType, string>

type MyOrg = ApiResult<typeof myOrganizations>[number]

type DirectoryOrg = ApiResult<typeof listDirectory>[number]

type OrgProfile = ApiResult<typeof getOrganization>

function TypeBadge({ type }: { type: OrgType }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
      {ORG_TYPE[type]}
    </span>
  )
}

/** Turns a pasted invite link or bare code into the code. */
function inviteCode(text: string) {
  const trimmed = text.trim()
  const match = /\/join\/([A-Za-z0-9_-]+)/.exec(trimmed)
  return match?.[1] ?? (/^[A-Za-z0-9_-]{16,}$/.test(trimmed) ? trimmed : null)
}

export function MyOrganizations() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [code, setCode] = useState("")
  const mine = useQuery({
    queryKey: ["me", "orgs"],
    queryFn: () => api<MyOrg[]>("/me/orgs"),
  })
  const directory = useQuery({
    queryKey: ["orgs", search],
    queryFn: () => api<DirectoryOrg[]>(`/orgs?q=${encodeURIComponent(search)}`),
  })
  if (!mine.data) return <Loading error={mine.error} />
  const joined = new Set(mine.data.map((o) => o.slug))
  const parsed = inviteCode(code)

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-display-lg text-ink">Organizations</h1>
        <SignupLink />
      </div>
      <p className="mb-5 text-body-sm text-body">
        Your account is yours. Join colleges, companies and communities to get
        their assignments, contests and classes; you can belong to several.
      </p>

      <section className="mb-8 grid gap-3">
        <h2 className="text-title-sm text-ink">Yours</h2>
        {mine.data.length === 0 && (
          <p className="text-body-sm text-body">
            You haven&apos;t joined any yet. Find yours below, or use the invite
            link someone sent you.
          </p>
        )}
        <div className="grid gap-3 min-[901px]:grid-cols-2">
          {mine.data.map((org) => (
            <div
              key={org.slug}
              data-testid="my-org"
              className="grid gap-2 rounded-lg border border-hairline bg-card p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={orgPages(org.slug).home}
                  className="text-title-md text-ink hover:underline"
                >
                  {org.name}
                </Link>
                <span className="flex gap-1.5">
                  <TypeBadge type={org.type} />
                  {org.status === "pending" && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      Waiting for approval
                    </span>
                  )}
                </span>
              </div>
              {org.roles.length > 0 && (
                <div className="text-caption text-body">
                  {org.roles.join(" · ")}
                </div>
              )}
              {org.canManage && (
                <Link
                  href={orgPages(org.slug).home}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "justify-self-start"
                  )}
                >
                  Manage
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 grid gap-2">
        <h2 className="text-title-sm text-ink">Have an invite?</h2>
        <form
          className="flex max-w-xl gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (parsed) router.push(`/join/${parsed}`)
          }}
        >
          <TextInput
            aria-label="Invite link or code"
            placeholder="Paste the invite link or code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" disabled={!parsed}>
            Open
          </Button>
        </form>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title-sm text-ink">Find an organization</h2>
          <TextInput
            aria-label="Search organizations"
            placeholder="Search by name"
            className="w-64"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {directory.data?.length === 0 && (
          <p className="text-body-sm text-body">Nothing found.</p>
        )}
        <div className="grid gap-3 min-[901px]:grid-cols-2">
          {directory.data?.map((org) => (
            <Link
              key={org.slug}
              href={orgPages(org.slug).home}
              className="grid gap-1.5 rounded-lg border border-hairline bg-card p-4 hover:border-hairline-strong"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-title-sm text-ink">{org.name}</span>
                <TypeBadge type={org.type} />
              </div>
              {org.description && (
                <p className="line-clamp-2 text-caption text-body">
                  {org.description}
                </p>
              )}
              <div className="text-xs text-body">
                {org.members} members
                {joined.has(org.slug)
                  ? " · You're a member"
                  : org.joinPolicy === "open"
                    ? " · Anyone can join"
                    : org.joinPolicy === "approval"
                      ? " · Join on approval"
                      : " · Invite only"}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}

function ShareChoice({
  value,
  onChange,
  orgName,
}: {
  value: boolean
  onChange: (value: boolean) => void
  orgName: string
}) {
  return (
    <label className="flex max-w-xl items-start gap-2 text-caption text-body">
      <Checkbox
        checked={value}
        onCheckedChange={(checked) => onChange(checked)}
      />
      <span>
        Let {orgName} see my practice progress too (problems solved, streaks).
        Work you do for its assignments and contests is always visible to it.
        You can change this later.
      </span>
    </label>
  )
}

export function OrgProfileView({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const { data: viewer } = useViewer()
  const [share, setShare] = useState(false)
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const { data, error } = useQuery({
    queryKey: ["org", slug],
    queryFn: () => api<OrgProfile>(`/orgs/${slug}`),
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["org", slug] })
    void queryClient.invalidateQueries({ queryKey: ["me", "orgs"] })
  }
  const join = useMutation({
    mutationFn: () =>
      api<{ status: string }>(`/orgs/${slug}/join`, {
        body: { shareProgress: share },
      }),
    onSuccess: (result) => {
      refresh()
      setMessage({
        text:
          result.status === "active"
            ? "You're in."
            : "Request sent. You'll be a member once it's approved.",
        kind: "ok",
      })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const leave = useMutation({
    mutationFn: () => api(`/orgs/${slug}/membership`, { method: "DELETE" }),
    onSuccess: () => {
      refresh()
      router.push("/orgs")
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const shareChange = useMutation({
    mutationFn: (value: boolean) =>
      api(`/orgs/${slug}/membership`, {
        method: "PATCH",
        body: { shareProgress: value },
      }),
    onSuccess: refresh,
  })
  if (!data) return <Loading error={error} />

  const member = data.membership

  return (
    <>
      <Link href="/orgs" className="text-caption text-body hover:text-ink">
        ← Organizations
      </Link>
      <div className="mt-2 mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-display-lg text-ink">{data.name}</h1>
        <TypeBadge type={data.type} />
      </div>
      <p className="mb-4 text-caption text-body">
        {data.members} members
        {data.website && (
          <>
            {" · "}
            <a
              href={data.website}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              {data.website.replace(/^https?:\/\//, "")}
            </a>
          </>
        )}
      </p>
      {data.description && (
        <p className="mb-5 max-w-3xl text-body-sm whitespace-pre-wrap text-body">
          {data.description}
        </p>
      )}

      <div className="grid max-w-3xl gap-3 rounded-lg border border-hairline bg-card p-4">
        {!viewer?.user ? (
          <p className="text-body-sm text-body">
            <Link
              href={`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`}
              className="text-ink underline underline-offset-2"
            >
              Sign in
            </Link>{" "}
            to join.
          </p>
        ) : member?.status === "active" ? (
          <>
            <p className="text-body-sm text-ink">
              You&apos;re a member
              {member.roles.some((r) => r !== "member") &&
                ` (${member.roles
                  .filter((r) => r !== "member")
                  .map((r) => (r === "custom" ? "custom role" : r))
                  .join(", ")})`}
              .
            </p>
            <ShareChoice
              value={member.shareProgress}
              onChange={(value) => shareChange.mutate(value)}
              orgName={data.name}
            />
            <div className="flex flex-wrap gap-2">
              {data.canManage && (
                <Link
                  href={orgPages(slug).home}
                  className={cn(buttonVariants({ size: "sm" }))}
                >
                  Manage
                </Link>
              )}
              <ConfirmButton
                variant="outline"
                size="sm"
                disabled={leave.isPending}
                title={`Leave ${data.name}?`}
                description="You lose its assignments, contests and groups. To come back you'll need to join again, which may need an invite or approval."
                confirmLabel="Leave"
                onConfirm={() => leave.mutate()}
              >
                Leave
              </ConfirmButton>
            </div>
          </>
        ) : member?.status === "pending" ? (
          <p className="text-body-sm text-ink">
            Your request is waiting for approval.
          </p>
        ) : data.joinOption === "invite_only" ? (
          <p className="text-body-sm text-body">
            {data.name} takes members by invite link only. Ask them for one.
          </p>
        ) : data.joinOption === "closed" ? (
          <p className="text-body-sm text-body">
            {data.name} isn&apos;t taking members right now.
          </p>
        ) : (
          <>
            <ShareChoice
              value={share}
              onChange={setShare}
              orgName={data.name}
            />
            <Button
              className="justify-self-start"
              disabled={join.isPending}
              onClick={() => join.mutate()}
            >
              {data.joinOption === "join"
                ? `Join ${data.name}`
                : `Ask to join ${data.name}`}
            </Button>
          </>
        )}
        <FormMessage message={message} />
      </div>
      {data.pendingApproval && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-hairline bg-card p-4 text-body-sm text-ink"
          data-testid="pending-approval"
        >
          {data.name} is waiting for the platform&apos;s approval. You&apos;ll
          get a notification when it&apos;s ready to use.
        </p>
      )}
      {data.admissionsOpen && member?.status !== "active" && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-card p-4"
          data-testid="admissions-open"
        >
          <div>
            <div className="font-medium text-ink">Admissions are open</div>
            <div className="text-body-sm text-body">
              Apply online; the school replies here and by email.
            </div>
          </div>
          <ApplyButton slug={slug} />
        </div>
      )}
      {member?.status === "active" && <OrgFeed slug={slug} />}
    </>
  )
}

type Feed = ApiResult<typeof orgFeed>

/** What a member has from this organization: notices, assignments and contests. */
function OrgFeed({ slug }: { slug: string }) {
  const { data } = useQuery({
    queryKey: ["org", slug, "feed"],
    queryFn: () => api<Feed>(`/orgs/${slug}/feed`),
  })
  const practice = useQuery({
    queryKey: ["org", slug, "practice"],
    queryFn: () =>
      api<{
        org: string
        summaries: { id: string; title: string; membersOnly: boolean }[]
      }>(`/orgs/${slug}/practice`),
  })
  if (!data) return null
  const open = data.assignments.filter(
    (a) => a.phase === "open" || a.phase === "late"
  )
  const contests = data.contests.filter((c) => c.phase !== "ended")
  return (
    <div className="mt-6 grid max-w-3xl gap-5">
      <RateClasses slug={slug} />
      {data.notices.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-title-sm text-ink">Notices</h2>
          {data.notices.map((n) => (
            <div
              key={n.id}
              data-testid="org-notice"
              className="rounded-lg border border-hairline-strong bg-canvas-soft p-3 text-body-sm whitespace-pre-wrap text-ink"
            >
              {n.text}
              <div className="mt-1 text-xs text-body">
                {formatDate(n.createdAt)}
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="grid gap-2">
        <h2 className="text-title-sm text-ink">Assignments due</h2>
        {open.length === 0 && (
          <p className="text-body-sm text-body">Nothing due.</p>
        )}
        {open.map((a) => (
          <Link
            key={a.slug}
            href={`/assignments/${a.slug}`}
            data-testid="org-assignment"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-card p-3 hover:border-hairline-strong"
          >
            <span className="text-ink">{a.title}</span>
            <span className="text-caption text-body tabular-nums">
              {a.earned} / {a.total} · due {formatDateTime(a.dueAt)}
            </span>
          </Link>
        ))}
      </section>
      {practice.data && practice.data.summaries.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-title-sm text-ink">
            Problems from {practice.data.org}
          </h2>
          <div className="grid gap-1.5 min-[701px]:grid-cols-2">
            {practice.data.summaries.map((p) => (
              <Link
                key={p.id}
                href={orgPages(slug).practice(p.id)}
                data-testid="org-problem"
                className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-card px-3 py-2 hover:border-hairline-strong"
              >
                <span className="text-ink">{p.title}</span>
                {p.membersOnly && (
                  <span className="text-xs text-body">Members only</span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="grid gap-2">
        <h2 className="text-title-sm text-ink">Contests</h2>
        {contests.length === 0 && (
          <p className="text-body-sm text-body">None coming up.</p>
        )}
        {contests.map((c) => (
          <Link
            key={c.slug}
            href={`/contests/${c.slug}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-card p-3 hover:border-hairline-strong"
          >
            <span className="text-ink">{c.title}</span>
            <span className="text-caption text-body">
              {c.phase === "live"
                ? "Live now"
                : `Starts ${formatDateTime(c.startsAt)}`}
            </span>
          </Link>
        ))}
      </section>
    </div>
  )
}

type InviteView = ApiResult<typeof getInvite>

export function JoinInvite({ token }: { token: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const { data: viewer } = useViewer()
  const [share, setShare] = useState(false)
  const { data, error } = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<InviteView>(`/invites/${token}`),
  })
  const accept = useMutation({
    mutationFn: () =>
      api<{ slug: string }>(`/invites/${token}`, {
        body: { shareProgress: share },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["me", "orgs"] })
      void queryClient.invalidateQueries({ queryKey: ["org", result.slug] })
      router.push(orgPages(result.slug).home)
    },
  })
  if (!data) return <Loading error={error} />

  return (
    <div className="mx-auto grid max-w-xl gap-4 py-10">
      <p className="text-caption-upper text-body uppercase">
        You&apos;re invited to
      </p>
      <h1 className="text-display-lg text-ink">{data.org.name}</h1>
      <p className="text-body-sm text-body">
        {ORG_TYPE[data.org.type]} · You&apos;ll join as{" "}
        <b className="text-ink">{data.role}</b>
        {data.group && (
          <>
            {" "}
            in <b className="text-ink">{data.group}</b>
          </>
        )}
        {data.forEmail && <> · For {data.forEmail}</>}
      </p>
      {data.org.description && (
        <p className="text-body-sm whitespace-pre-wrap text-body">
          {data.org.description}
        </p>
      )}
      {data.problem ? (
        <p role="alert" className="text-body-sm text-destructive">
          {data.problem}
        </p>
      ) : !viewer?.user ? (
        <Link
          href={`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`}
          className={cn(buttonVariants(), "justify-self-start")}
        >
          Sign in to join
        </Link>
      ) : (
        <>
          <ShareChoice
            value={share}
            onChange={setShare}
            orgName={data.org.name}
          />
          <Button
            className="justify-self-start"
            disabled={accept.isPending}
            onClick={() => accept.mutate()}
          >
            Join {data.org.name}
          </Button>
          {accept.error && (
            <p role="alert" className="text-body-sm text-destructive">
              {accept.error.message}
            </p>
          )}
        </>
      )}
    </div>
  )
}

type ClassToRate = ApiResult<typeof classesToRate>[number]

/** Students rate their recent classes: 1 to 5 stars and an optional comment, once each. */
function RateClasses({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["org", slug, "classes-to-rate"],
    queryFn: () => api<ClassToRate[]>(`/orgs/${slug}/classes-to-rate`),
  })
  if (!data?.length) return null
  return (
    <section className="grid gap-2">
      <h2 className="text-title-sm text-ink">Rate your recent classes</h2>
      <p className="text-caption text-body">
        Teachers see the average and comments, never who wrote them.
      </p>
      {data.map((c) => (
        <RateOne
          key={c.id}
          slug={slug}
          item={c}
          onDone={() =>
            void queryClient.invalidateQueries({
              queryKey: ["org", slug, "classes-to-rate"],
            })
          }
        />
      ))}
    </section>
  )
}

function RateOne({
  slug,
  item,
  onDone,
}: {
  slug: string
  item: ClassToRate
  onDone: () => void
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const send = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/sessions/${item.id}/feedback`, {
        body: { rating, comment },
      }),
    onSuccess: onDone,
  })
  return (
    <div
      data-testid="rate-class"
      className="grid gap-2 rounded-lg border border-hairline bg-card p-3"
    >
      <div className="text-body-sm text-ink">
        {item.group} · {formatDate(item.day)} · {item.teacher}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span role="radiogroup" aria-label="Rating" className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              type="button"
              variant="ghost"
              size="icon-xs"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              className={cn(
                "size-auto p-0 text-title-md leading-none hover:bg-transparent",
                n <= rating ? "text-primary" : "text-muted-soft"
              )}
              onClick={() => setRating(n)}
            >
              ★
            </Button>
          ))}
        </span>
        <TextInput
          aria-label="Comment"
          placeholder="Optional comment"
          className="w-72 py-1"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Button
          size="sm"
          disabled={rating === 0 || send.isPending}
          onClick={() => send.mutate()}
        >
          Send
        </Button>
      </div>
    </div>
  )
}
