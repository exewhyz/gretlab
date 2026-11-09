"use client"

import { ArrowUpIcon, ChatCircleIcon, CheckCircleIcon, LockSimpleIcon, PushPinIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { Check, Field, FormMessage, SelectInput, TextArea, TextInput } from "@/components/form"
import { Markdown } from "@/components/markdown"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

/*
 * A class's discussion: threads and replies. Students and teachers post; teachers pin,
 * lock, hide and mark answers. Anonymous posts hide the author from classmates only.
 */

interface Post {
  id: string
  title: string
  body: string
  deleted: boolean
  hidden: boolean
  pinned: boolean
  locked: boolean
  answerId: string | null
  anonymous: boolean
  author: string | null
  byTeacher: boolean
  own: boolean
  createdAt: string
  editedAt: string | null
  activityAt: string
  votes: number
  voted: boolean
}

interface Board {
  teacher: boolean
  threads: (Post & { replies: number })[]
}

interface Thread {
  teacher: boolean
  thread: Post
  replies: Post[]
}

export function Discussion({
  slug,
  groupId,
  initialThread = null,
}: {
  slug: string
  groupId: string
  initialThread?: string | null
}) {
  const [open, setOpen] = useState<string | null>(initialThread)
  const choose = (id: string | null) => {
    setOpen(id)
    // Kept in the address so a thread can be linked to (notifications do).
    const url = new URL(window.location.href)
    if (id) url.searchParams.set("thread", id)
    else url.searchParams.delete("thread")
    window.history.replaceState(null, "", url)
  }
  return open ? (
    <ThreadView slug={slug} groupId={groupId} id={open} onBack={() => choose(null)} />
  ) : (
    <ThreadList slug={slug} groupId={groupId} onOpen={choose} />
  )
}

function ThreadList({
  slug,
  groupId,
  onOpen,
}: {
  slug: string
  groupId: string
  onOpen: (id: string) => void
}) {
  const base = `/orgs/${slug}/classes/${groupId}/discussion`
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class", groupId, "discussion"],
    queryFn: () => api<Board>(base),
  })
  const [search, setSearch] = useState("")
  const [show, setShow] = useState("")
  const [writing, setWriting] = useState(false)
  const threads = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.threads ?? []).filter(
      (t) =>
        (!q || t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)) &&
        (show !== "unanswered" || (!t.answerId && !t.locked)) &&
        (show !== "mine" || t.own)
    )
  }, [data, search, show])
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-3" data-testid="discussion">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setWriting(true)}>
          New post
        </Button>
        <TextInput
          aria-label="Search the discussion"
          placeholder="Search posts"
          className="w-56"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SelectInput aria-label="Show" className="w-40" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="">All posts</option>
          <option value="unanswered">Not answered</option>
          <option value="mine">Mine</option>
        </SelectInput>
      </div>
      {data.threads.length === 0 ? (
        <p className="text-body-sm text-body">
          Nothing here yet. Ask a question or start a discussion; everyone in this class can
          see it.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {threads.map((t) => (
            <li key={t.id}>
              <Button
                variant="ghost"
                data-testid="thread-row"
                className={cn(
                  "h-auto w-full justify-start gap-3 rounded-md border border-hairline bg-card px-3 py-2 text-left font-normal whitespace-normal",
                  t.hidden && "opacity-60"
                )}
                onClick={() => onOpen(t.id)}
              >
                <span className="grid w-8 shrink-0 justify-items-center text-caption tabular-nums">
                  <ArrowUpIcon className="size-3.5" />
                  {t.votes}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {t.pinned && <PushPinIcon aria-label="Pinned" weight="fill" className="size-3.5 text-primary" />}
                    <span className="truncate font-medium text-ink">{t.deleted ? "Deleted post" : t.title}</span>
                    {t.answerId && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-success">
                        <CheckCircleIcon weight="fill" className="size-3.5" /> Answered
                      </span>
                    )}
                    {t.locked && <LockSimpleIcon aria-label="Locked" className="size-3.5 text-body" />}
                    {t.hidden && <span className="text-xs text-destructive">Hidden</span>}
                  </span>
                  <span className="block truncate text-caption">
                    {t.author ?? "—"}
                    {t.byTeacher && " (teacher)"} · {formatDateTime(t.activityAt)}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-caption tabular-nums">
                  <ChatCircleIcon className="size-4" />
                  {t.replies}
                </span>
              </Button>
            </li>
          ))}
          {threads.length === 0 && <li className="text-body-sm text-body">Nothing matches.</li>}
        </ul>
      )}
      {writing && (
        <NewThreadDialog
          base={base}
          teacher={data.teacher}
          onDone={(id) => {
            setWriting(false)
            if (id) onOpen(id)
          }}
        />
      )}
    </div>
  )
}

function NewThreadDialog({
  base,
  teacher,
  onDone,
}: {
  base: string
  teacher: boolean
  onDone: (id?: string) => void
}) {
  const client = useQueryClient()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [anonymous, setAnonymous] = useState(false)
  const post = useMutation({
    mutationFn: () => api<{ id: string }>(base, { body: { title, body, anonymous } }),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: ["org"] })
      onDone(r.id)
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New post</DialogTitle>
          <DialogDescription>Everyone in this class sees it. Markdown and code blocks work.</DialogDescription>
        </DialogHeader>
        <Field label="Title">
          <TextInput aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Post">
          <TextArea
            rows={6}
            aria-label="Post"
            placeholder={"What did you try? Paste code in a block:\n```python\nprint('hi')\n```"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        {!teacher && (
          <Check
            checked={anonymous}
            onCheckedChange={setAnonymous}
            label="Post anonymously (your teachers still see your name)"
          />
        )}
        {post.error && <FormMessage message={{ text: post.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || !body.trim() || post.isPending} onClick={() => post.mutate()}>
            Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ThreadView({
  slug,
  groupId,
  id,
  onBack,
}: {
  slug: string
  groupId: string
  id: string
  onBack: () => void
}) {
  const base = `/orgs/${slug}/classes/${groupId}/discussion`
  const key = ["org", slug, "class", groupId, "discussion", id]
  const client = useQueryClient()
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api<Thread>(`${base}/${id}`) })
  const [reply, setReply] = useState("")
  const [anonymous, setAnonymous] = useState(false)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["org", slug, "class", groupId, "discussion"] })
  }
  const send = useMutation({
    mutationFn: () => api(`${base}/${id}`, { body: { body: reply, anonymous } }),
    onSuccess: () => {
      setReply("")
      setAnonymous(false)
      refresh()
    },
  })
  const change = useMutation({
    mutationFn: ({ postId, ...body }: { postId: string } & Record<string, unknown>) =>
      api(`${base}/${postId}`, { method: "PATCH", body }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (postId: string) => api(`${base}/${postId}`, { method: "DELETE" }),
    onSuccess: (_, postId) => {
      if (postId === id) {
        refresh()
        onBack()
      } else refresh()
    },
  })
  const vote = useMutation({
    mutationFn: (postId: string) => api(`${base}/${postId}/vote`, { body: {} }),
    onSuccess: refresh,
  })
  if (!data) {
    return (
      <div className="grid gap-2">
        <Button variant="link" className="justify-self-start px-0" onClick={onBack}>
          ← All posts
        </Button>
        <Loading error={error} />
      </div>
    )
  }
  const t = data.thread
  const teacher = data.teacher
  const failure = send.error ?? change.error ?? remove.error ?? vote.error
  const sorted = [
    ...data.replies.filter((r) => r.id === t.answerId),
    ...data.replies.filter((r) => r.id !== t.answerId),
  ]

  const actions = (p: Post, isThread: boolean) => (
    <span className="flex flex-wrap items-center gap-1">
      <Button
        variant={p.voted ? "secondary" : "ghost"}
        size="xs"
        aria-label={`+1 (${p.votes})`}
        disabled={p.own || p.deleted || vote.isPending}
        onClick={() => vote.mutate(p.id)}
      >
        <ArrowUpIcon className="size-3.5" /> {p.votes}
      </Button>
      {teacher && !isThread && !p.deleted && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => change.mutate({ postId: id, answerId: t.answerId === p.id ? null : p.id })}
        >
          {t.answerId === p.id ? "Not the answer" : "Mark as answer"}
        </Button>
      )}
      {teacher && isThread && (
        <>
          <Button variant="ghost" size="xs" onClick={() => change.mutate({ postId: id, pinned: !t.pinned })}>
            {t.pinned ? "Unpin" : "Pin"}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => change.mutate({ postId: id, locked: !t.locked })}>
            {t.locked ? "Unlock" : "Lock"}
          </Button>
        </>
      )}
      {teacher && !p.deleted && (
        <Button variant="ghost" size="xs" onClick={() => change.mutate({ postId: p.id, hidden: !p.hidden })}>
          {p.hidden ? "Show" : "Hide"}
        </Button>
      )}
      {(p.own || teacher) && !p.deleted && (
        <ConfirmButton
          variant="ghost"
          size="xs"
          title={isThread ? "Delete this post?" : "Delete this reply?"}
          description={
            isThread
              ? "If it has replies, it stays as a deleted post so they still make sense."
              : "It's removed for everyone."
          }
          confirmLabel="Delete"
          onConfirm={() => remove.mutate(p.id)}
        >
          Delete
        </ConfirmButton>
      )}
    </span>
  )

  const byline = (p: Post) => (
    <span className="text-caption">
      {p.author ?? "—"}
      {p.byTeacher && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-xs text-primary">Teacher</span>}
      {p.anonymous && (p.own || teacher) && <span className="ml-1 text-xs">(anonymous to classmates)</span>}
      {" · "}
      {formatDateTime(p.createdAt)}
      {p.editedAt && " · edited"}
      {p.hidden && <span className="ml-1 text-destructive">· Hidden from students</span>}
    </span>
  )

  return (
    <div className="grid gap-3" data-testid="thread">
      <Button variant="link" className="justify-self-start px-0" onClick={onBack}>
        ← All posts
      </Button>
      <article className={cn("grid gap-2 rounded-lg border border-hairline bg-card p-4", t.hidden && "opacity-70")}>
        <h2 className="flex flex-wrap items-center gap-2 text-display-sm text-ink">
          {t.pinned && <PushPinIcon aria-label="Pinned" weight="fill" className="size-4 text-primary" />}
          {t.deleted ? "Deleted post" : t.title}
          {t.locked && <LockSimpleIcon aria-label="Locked" className="size-4 text-body" />}
        </h2>
        {byline(t)}
        {t.deleted ? (
          <p className="text-body-sm text-body">This post was deleted.</p>
        ) : (
          <Markdown text={t.body} />
        )}
        {actions(t, true)}
      </article>
      <h3 className="text-body-sm font-semibold text-ink">
        {data.replies.length} {data.replies.length === 1 ? "reply" : "replies"}
      </h3>
      <ol className="grid gap-2">
        {sorted.map((r) => (
          <li
            key={r.id}
            data-testid="reply"
            className={cn(
              "grid gap-1.5 rounded-md border bg-card p-3",
              r.id === t.answerId ? "border-success" : "border-hairline",
              r.hidden && "opacity-70"
            )}
          >
            {r.id === t.answerId && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <CheckCircleIcon weight="fill" className="size-3.5" /> Answer
              </span>
            )}
            {byline(r)}
            <Markdown text={r.body} />
            {actions(r, false)}
          </li>
        ))}
      </ol>
      {failure && <FormMessage message={{ text: failure.message, kind: "err" }} />}
      {t.deleted ? null : t.locked && !teacher ? (
        <p className="text-body-sm text-body">A teacher locked this thread; no more replies.</p>
      ) : (
        <div className="grid gap-2">
          <TextArea
            rows={4}
            aria-label="Your reply"
            placeholder="Write a reply. Markdown and code blocks work."
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>
              Reply
            </Button>
            {!teacher && (
              <Check checked={anonymous} onCheckedChange={setAnonymous} label="Anonymously" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
