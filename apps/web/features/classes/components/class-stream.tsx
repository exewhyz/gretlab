"use client"

import {
  ChalkboardTeacherIcon,
  ClipboardTextIcon,
  MegaphoneIcon,
  TrophyIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"

import { ConfirmButton } from "@/components/confirm"
import { FormMessage } from "@/components/form"
import { Card, Loading } from "@/features/admin/components/shell"
import { type Message } from "@/features/orgs/components/manage-shared"
import { api } from "@/lib/api/client"
import { formatDateTime, formatDay } from "@/lib/format"

/*
 * A class: one group someone teaches, with everything about it in tabs. Teachers see
 * and act on all of it; students see their side of the same tabs.
 */
import { Reach, ReachChip } from "./class-parts"

export type StreamItem =
  | {
      kind: "notice"
      id: string
      at: string
      text: string
      by: string | null
      reach: Reach
      canDelete: boolean
    }
  | {
      kind: "class"
      id: string
      at: string
      day: string
      minutes: number
      group: string | null
      topics: string[]
      note: string
      by: string | null
    }
  | {
      kind: "assignment"
      id: string
      at: string
      slug: string
      title: string
      dueAt: string
      reach: Reach
    }
  | {
      kind: "contest"
      id: string
      at: string
      slug: string
      title: string
      startsAt: string
      reach: Reach
    }

export function StreamCard({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <li
      data-testid="stream-item"
      className="flex gap-3 rounded-lg border border-hairline bg-card p-3.5"
    >
      <span className="mt-0.5 shrink-0 text-body">{icon}</span>
      <div className="grid min-w-0 flex-1 gap-1">{children}</div>
    </li>
  )
}

export function Stream({
  slug,
  groupId,
  canPost,
}: {
  slug: string
  groupId: string
  canPost: boolean
}) {
  const queryClient = useQueryClient()
  const key = ["org", slug, "class", groupId, "stream"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<StreamItem[]>(`/orgs/${slug}/classes/${groupId}/stream`),
  })
  const [text, setText] = useState("")
  const [message, setMessage] = useState<Message>(null)
  const act = useMutation({
    mutationFn: (call: () => Promise<unknown>) => call(),
    onSuccess: () => {
      setText("")
      setMessage(null)
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ["org", slug, "feed"] })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })

  return (
    <div className="grid gap-3">
      {canPost && (
        <Card className="grid gap-2">
          <Textarea
            aria-label="Notice for this class"
            placeholder="Tell the class something: a room change, a reminder, a link."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
          <FormMessage message={message} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-body">
              Everyone in this class sees it, including groups inside it.
            </span>
            <Button
              size="sm"
              disabled={!text.trim() || act.isPending}
              onClick={() =>
                act.mutate(() =>
                  api(`/orgs/${slug}/classes/${groupId}/stream`, {
                    body: { text },
                  })
                )
              }
            >
              Post
            </Button>
          </div>
        </Card>
      )}
      {!data && <Loading error={error} />}
      {data?.length === 0 && (
        <p className="text-body-sm text-body">
          Nothing here yet. Notices, logged classes and new work for this class
          show up here.
        </p>
      )}
      <ul className="grid gap-2">
        {data?.map((item) => {
          if (item.kind === "notice") {
            return (
              <StreamCard
                key={`n${item.id}`}
                icon={<MegaphoneIcon className="size-4" />}
              >
                <div className="flex flex-wrap items-center gap-2 text-caption text-body">
                  <span className="text-ink">{item.by ?? "Notice"}</span>
                  <span>{formatDateTime(item.at)}</span>
                  <ReachChip reach={item.reach} />
                  {item.canDelete && (
                    <ConfirmButton
                      size="xs"
                      variant="ghost"
                      className="ms-auto"
                      title="Remove this notice?"
                      description="Nobody will see it any more."
                      confirmLabel="Remove"
                      onConfirm={() =>
                        act.mutate(() =>
                          api(`/orgs/${slug}/notes/${item.id}`, {
                            method: "DELETE",
                          })
                        )
                      }
                    >
                      Remove
                    </ConfirmButton>
                  )}
                </div>
                <p className="text-body-sm whitespace-pre-wrap text-ink">
                  {item.text}
                </p>
              </StreamCard>
            )
          }
          if (item.kind === "class") {
            return (
              <StreamCard
                key={`c${item.id}`}
                icon={<ChalkboardTeacherIcon className="size-4" />}
              >
                <div className="text-body-sm text-ink">
                  Class on {formatDay(item.day)} · {item.minutes} min
                  {item.group && (
                    <span className="text-body"> · {item.group}</span>
                  )}
                </div>
                <div className="text-caption text-body">
                  {item.topics.length > 0
                    ? `Covered ${item.topics.join(", ")}`
                    : "No syllabus topics marked"}
                  {item.by && ` · ${item.by}`}
                </div>
                {item.note && (
                  <p className="text-caption text-ink">{item.note}</p>
                )}
              </StreamCard>
            )
          }
          if (item.kind === "assignment") {
            return (
              <StreamCard
                key={`a${item.id}`}
                icon={<ClipboardTextIcon className="size-4" />}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/assignments/${item.slug}`}
                    className="text-body-sm text-ink hover:underline"
                  >
                    New assignment: {item.title}
                  </Link>
                  <ReachChip reach={item.reach} />
                </div>
                <div className="text-caption text-body">
                  Due {formatDateTime(item.dueAt)}
                </div>
              </StreamCard>
            )
          }
          return (
            <StreamCard
              key={`k${item.id}`}
              icon={<TrophyIcon className="size-4" />}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/contests/${item.slug}`}
                  className="text-body-sm text-ink hover:underline"
                >
                  Contest: {item.title}
                </Link>
                <ReachChip reach={item.reach} />
              </div>
              <div className="text-caption text-body">
                Starts {formatDateTime(item.startsAt)}
              </div>
            </StreamCard>
          )
        })}
      </ul>
    </div>
  )
}
