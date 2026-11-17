"use client"

import { BookOpenIcon, CheckCircleIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { FormMessage } from "@/components/form"
import { Markdown } from "@/components/markdown"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { readingView } from "@/features/courses/readings"

/*
 * A course's reading, as a lesson page: the module's items down the side (this one marked),
 * the reading in markdown, Previous and Next through the course's open items, and "Mark as
 * completed", which counts toward finishing the module.
 */

type View = ApiResult<typeof readingView>

export function ReadingPage({
  slug,
  groupId,
  courseId,
  readingId,
}: {
  slug: string
  groupId: string
  courseId: string
  readingId: string
}) {
  const pages = orgPages(slug)
  const base = `/orgs/${slug}/classes/${groupId}/courses/${courseId}/readings/${readingId}`
  const key = ["org", slug, "class", groupId, "reading", readingId]
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<View>(base),
  })
  const mark = useMutation({
    mutationFn: (done: boolean) =>
      api(`${base}/done`, { method: "PUT", body: { done } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key })
      void client.invalidateQueries({
        queryKey: ["org", slug, "class", groupId, "courses"],
      })
    },
  })
  if (!data) return <Loading error={error} />

  const step = (s: View["next"], label: string, align: "start" | "end") =>
    s?.href ? (
      <Link
        href={s.href}
        className={cn(
          "grid max-w-[45%] gap-0.5 text-body-sm hover:text-ink",
          align === "end" && "text-right"
        )}
      >
        <span className="text-caption">{label}</span>
        <span className="truncate font-medium text-ink">{s.title}</span>
      </Link>
    ) : (
      <span />
    )

  return (
    <div
      className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]"
      data-testid="reading-page"
    >
      <aside className="grid content-start gap-2">
        <Link
          href={pages.cls(groupId, "course")}
          className="text-caption hover:text-ink"
        >
          ‹ Back to {data.course.title}
        </Link>
        <div className="text-body-sm font-semibold text-ink">
          {data.module.title}
        </div>
        <ol className="grid gap-0.5" data-testid="reading-module-items">
          {data.module.items.map((item) => {
            const here = item.kind === "reading" && item.id === readingId
            const content = (
              <>
                {item.done ? (
                  <CheckCircleIcon
                    aria-label="Done"
                    weight="fill"
                    className="size-4 shrink-0 text-success"
                  />
                ) : item.kind === "reading" ? (
                  <BookOpenIcon
                    aria-hidden
                    className="size-4 shrink-0 text-body"
                  />
                ) : (
                  <CheckCircleIcon
                    aria-label="Not done"
                    className="size-4 shrink-0 text-body"
                  />
                )}
                <span className="min-w-0 truncate">{item.title}</span>
              </>
            )
            return (
              <li key={`${item.kind}:${item.id}`}>
                {item.href && !here ? (
                  <Link
                    href={item.href}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body-sm hover:bg-muted"
                  >
                    {content}
                  </Link>
                ) : (
                  <span
                    aria-current={here ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-body-sm",
                      here && "bg-muted font-medium text-ink"
                    )}
                  >
                    {content}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </aside>

      <article className="grid min-w-0 content-start gap-4">
        <h1 className="text-display-sm text-ink">{data.reading.title}</h1>
        {data.reading.body ? (
          <div
            className="rounded-lg border border-hairline bg-card p-4 sm:p-6"
            data-testid="reading-body"
          >
            <Markdown text={data.reading.body} />
          </div>
        ) : (
          <p className="text-body-sm">Nothing written here yet.</p>
        )}
        {mark.error && (
          <FormMessage message={{ text: mark.error.message, kind: "err" }} />
        )}
        {!data.teacher && (
          <div className="flex flex-wrap items-center gap-3">
            {data.done ? (
              <>
                <span
                  className="inline-flex items-center gap-1.5 text-body-sm text-success"
                  data-testid="reading-done"
                >
                  <CheckCircleIcon weight="fill" className="size-4" /> Completed
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={mark.isPending}
                  onClick={() => mark.mutate(false)}
                >
                  Mark as not completed
                </Button>
              </>
            ) : (
              <Button
                disabled={mark.isPending}
                onClick={() => mark.mutate(true)}
              >
                Mark as completed
              </Button>
            )}
          </div>
        )}
        <nav
          aria-label="Course"
          className="flex items-start justify-between gap-4 border-t border-hairline pt-4"
        >
          {step(data.previous, "‹ Previous", "start")}
          {step(data.next, "Next ›", "end")}
        </nav>
      </article>
    </div>
  )
}
