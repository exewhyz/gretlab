"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpIcon, FlagIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Markdown } from "@/components/markdown"
import { Loading } from "@/features/admin/components/shell"
import type {
  getPost,
  listPosts,
  myAccepted,
} from "@/features/solutions/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

type List = ApiResult<typeof listPosts>
type Post = ApiResult<typeof getPost>
type Accepted = ApiResult<typeof myAccepted>

/**
 * A library problem's solution posts (features/solutions): the list, one post with its code
 * and comments, and sharing your own accepted solution. Opens on the same terms as the
 * editorial; the server decides.
 */
export function SolutionsPanel({ problemSlug }: { problemSlug: string }) {
  const [sort, setSort] = useState<"votes" | "new">("votes")
  const [view, setView] = useState<
    { name: "list" } | { name: "post"; id: string } | { name: "write" }
  >(() => {
    // A link from a notification opens its post.
    const post =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("post")
        : null
    return post ? { name: "post", id: post } : { name: "list" }
  })
  const list = useQuery({
    queryKey: ["solutions", problemSlug, sort],
    queryFn: () => api<List>(`/problems/${problemSlug}/solutions?sort=${sort}`),
  })
  if (view.name === "post")
    return (
      <PostView
        id={view.id}
        problemSlug={problemSlug}
        onBack={() => setView({ name: "list" })}
      />
    )
  if (view.name === "write")
    return (
      <WritePost
        problemSlug={problemSlug}
        onDone={(id) => setView(id ? { name: "post", id } : { name: "list" })}
      />
    )
  const data = list.data
  return (
    <div
      className="grid content-start gap-3 overflow-auto p-5"
      data-testid="solutions"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-title-sm text-ink">Solutions</h2>
        <span className="flex-1" />
        {data?.canRead && (
          <SelectInput
            aria-label="Sort solutions"
            className="w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as "votes" | "new")}
          >
            <option value="votes">Most votes</option>
            <option value="new">Newest</option>
          </SelectInput>
        )}
        {data?.canWrite && (
          <Button size="sm" onClick={() => setView({ name: "write" })}>
            {data.mine ? "Edit your solution" : "Share your solution"}
          </Button>
        )}
      </div>
      {!data ? (
        <Loading error={list.error} />
      ) : !data.canRead ? (
        <p className="text-body-sm text-body" data-testid="solutions-locked">
          {data.count > 0
            ? `${data.count} ${data.count === 1 ? "solution is" : "solutions are"} shared here.`
            : "Nobody has shared a solution yet."}{" "}
          Solve the problem to read them and share your own.
        </p>
      ) : data.posts.length === 0 ? (
        <p className="text-body-sm text-body">
          Nobody has shared a solution yet.
          {data.canWrite && " You've solved it: share how you did it."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {data.posts.map((p) => (
            <li key={p.id}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start rounded-lg px-3 py-2.5 text-left ring-1 ring-foreground/10"
                onClick={() => setView({ name: "post", id: p.id })}
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-body-sm font-medium text-ink">
                    {p.title}
                    {p.hidden && (
                      <span className="ml-2 text-caption text-destructive">
                        Hidden
                      </span>
                    )}
                  </span>
                  <span className="text-caption text-body">
                    {p.author} · {p.language} · {p.comments}{" "}
                    {p.comments === 1 ? "comment" : "comments"}
                    {p.reports ? ` · reported ${p.reports}×` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-caption text-body tabular-nums">
                  <ArrowUpIcon aria-hidden />
                  {p.votes}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PostView({
  id,
  problemSlug,
  onBack,
}: {
  id: string
  problemSlug: string
  onBack: () => void
}) {
  const client = useQueryClient()
  const post = useQuery({
    queryKey: ["solution", id],
    queryFn: () => api<Post>(`/solutions/${id}`),
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["solution", id] })
    void client.invalidateQueries({ queryKey: ["solutions", problemSlug] })
  }
  const vote = useMutation({
    mutationFn: (on: boolean) =>
      api(`/solutions/${id}/vote`, { method: "PUT", body: { on } }),
    onSuccess: refresh,
  })
  const report = useMutation({
    mutationFn: () => api(`/solutions/${id}/report`, { method: "POST" }),
    onSuccess: refresh,
    meta: { success: "Reported. Moderators will take a look." },
  })
  const remove = useMutation({
    mutationFn: () => api(`/solutions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh()
      onBack()
    },
  })
  const moderate = useMutation({
    mutationFn: (input: {
      kind: "post" | "comment"
      id: string
      hidden: boolean
    }) => api("/admin/solutions", { body: input }),
    onSuccess: refresh,
  })
  const [comment, setComment] = useState("")
  const send = useMutation({
    mutationFn: () =>
      api(`/solutions/${id}/comments`, { body: { body: comment } }),
    onSuccess: () => {
      setComment("")
      refresh()
    },
  })
  const p = post.data
  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-auto p-5"
      data-testid="solution-post"
    >
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← All solutions
        </Button>
      </div>
      {!p ? (
        <Loading error={post.error} />
      ) : (
        <>
          <div className="grid gap-1">
            <h2 className="text-title-md text-ink">{p.title}</h2>
            <p className="text-caption text-body">
              {p.author} · {p.language} · {formatDate(p.updatedAt)}
              {p.hidden && (
                <span className="ml-2 text-destructive">
                  Hidden by a moderator
                </span>
              )}
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={p.voted ? "default" : "outline"}
                disabled={p.own || vote.isPending}
                aria-pressed={p.voted}
                onClick={() => vote.mutate(!p.voted)}
                title={p.own ? "You can't vote on your own post" : undefined}
              >
                <ArrowUpIcon aria-hidden /> {p.votes}
              </Button>
              {!p.own && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => report.mutate()}
                  disabled={report.isPending}
                >
                  <FlagIcon aria-hidden /> Report
                </Button>
              )}
              {p.own && (
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  title="Delete your solution post?"
                  description="Its votes and comments go with it."
                  confirmLabel="Delete post"
                  onConfirm={() => remove.mutate()}
                >
                  Delete
                </ConfirmButton>
              )}
              {p.canModerate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    moderate.mutate({
                      kind: "post",
                      id: p.id,
                      hidden: !p.hidden,
                    })
                  }
                >
                  {p.hidden ? "Show again" : "Hide"}
                </Button>
              )}
              {p.canModerate && p.reports ? (
                <span className="self-center text-caption text-body">
                  Reported {p.reports}×
                </span>
              ) : null}
            </div>
          </div>
          <Markdown text={p.body} className="text-body-sm text-ink" />
          <pre className="overflow-auto rounded-md border border-hairline bg-muted p-3 font-mono text-[13px] leading-5 text-ink [font-variant-ligatures:none]">
            {p.code}
          </pre>
          <section className="grid gap-2" aria-label="Comments">
            <h3 className="text-title-sm text-ink">
              Comments ({p.comments.length})
            </h3>
            {p.comments.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "rounded-md px-3 py-2 ring-1 ring-foreground/10",
                  c.hidden && "opacity-60"
                )}
              >
                <div className="text-caption text-body">
                  {c.author} · {formatDate(c.createdAt)}
                  {c.hidden && " · hidden"}
                </div>
                <p className="text-body-sm whitespace-pre-wrap text-ink">
                  {c.body}
                </p>
                {p.canModerate && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      moderate.mutate({
                        kind: "comment",
                        id: c.id,
                        hidden: !c.hidden,
                      })
                    }
                  >
                    {c.hidden ? "Show again" : "Hide"}
                  </Button>
                )}
              </div>
            ))}
            <TextArea
              aria-label="Your comment"
              placeholder="Ask about it or suggest something"
              rows={2}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div>
              <Button
                size="sm"
                disabled={!comment.trim() || send.isPending}
                onClick={() => send.mutate()}
              >
                Comment
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function WritePost({
  problemSlug,
  onDone,
}: {
  problemSlug: string
  onDone: (id: string | null) => void
}) {
  const client = useQueryClient()
  const accepted = useQuery({
    queryKey: ["solutions", problemSlug, "accepted"],
    queryFn: () => api<Accepted>(`/problems/${problemSlug}/solutions/accepted`),
  })
  const [submissionId, setSubmissionId] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/problems/${problemSlug}/solutions`, {
        body: {
          title,
          body,
          submissionId: submissionId || accepted.data?.[0]?.id,
        },
      }),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ["solutions", problemSlug] })
      onDone(saved.id)
    },
    meta: { quiet: true, success: "Your solution is shared." },
  })
  if (!accepted.data) return <Loading error={accepted.error} />
  return (
    <div
      className="grid content-start gap-3 overflow-auto p-5"
      data-testid="write-solution"
    >
      <h2 className="text-title-sm text-ink">Share your solution</h2>
      <p className="text-caption text-body">
        Your code comes from one of your accepted submissions, so everyone knows
        it passes. People who&apos;ve solved this problem see it with your name.
      </p>
      <Field label="Code">
        <SelectInput
          value={submissionId || accepted.data[0]?.id || ""}
          onChange={(e) => setSubmissionId(e.target.value)}
        >
          {accepted.data.map((s) => (
            <option key={s.id} value={s.id}>
              {s.language}, accepted {formatDate(s.createdAt)}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Title">
        <TextInput
          value={title}
          maxLength={120}
          placeholder="Two pointers in one pass"
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field
        label="How it works"
        help="Markdown. Explain the idea, not just the code."
      >
        <TextArea
          rows={8}
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {save.error && (
        <FormMessage message={{ text: save.error.message, kind: "err" }} />
      )}
      <div className="flex gap-2">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Share
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
