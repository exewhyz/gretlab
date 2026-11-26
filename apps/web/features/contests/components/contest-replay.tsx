"use client"

import { useQuery } from "@tanstack/react-query"

import { verdictLabel } from "@workspace/judge"

import { DetailSheet } from "@/components/detail-sheet"
import { Loading } from "@/features/admin/components/shell"
import { PlaybackView } from "@/features/drafts/components/student-work"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDateTime } from "@/lib/format"

import type { contestReplay } from "@/features/contests/replay"

type Replay = ApiResult<typeof contestReplay>

/** Minutes into the contest, as the board counts them. */
const minuteOf = (at: string, startsAt: string) =>
  Math.max(
    0,
    Math.floor((new Date(at).getTime() - new Date(startsAt).getTime()) / 60000)
  )

/**
 * For whoever runs a contest: how one contestant's code for one problem was written while it
 * ran, their graded submissions on the timeline, and the steps where a lot of code appeared at
 * once. Opened from a cell of the board (features/contests/replay.ts).
 */
export function ContestReplay({
  slug,
  userId,
  name,
  label,
  onClose,
}: {
  slug: string
  userId: string
  name: string
  label: string
  onClose: () => void
}) {
  const { data, error } = useQuery({
    queryKey: ["contest-replay", slug, userId, label],
    queryFn: () =>
      api<Replay>(
        `/contests/${slug}/replay?user=${encodeURIComponent(userId)}&problem=${encodeURIComponent(label)}`
      ),
  })
  return (
    <DetailSheet
      testId="contest-replay"
      onClose={onClose}
      title={`${name}: ${label}${data ? ` · ${data.problem.title}` : ""}`}
      description="How the code was written during the contest, saved every few seconds as they typed."
    >
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <section className="grid gap-2">
            <h3 className="text-title-sm text-ink">Submissions</h3>
            {data.attempts.length === 0 ? (
              <p className="text-body-sm text-body">
                No graded submissions for this problem.
              </p>
            ) : (
              <ul
                className="grid divide-y divide-hairline rounded-md border border-hairline text-body-sm"
                data-testid="replay-attempts"
              >
                {data.attempts.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                  >
                    <span className="w-20 text-caption text-body tabular-nums">
                      Minute {minuteOf(a.createdAt, data.contest.startsAt)}
                    </span>
                    <span
                      className={
                        a.verdict === "AC"
                          ? "font-medium text-success"
                          : "font-medium text-ink"
                      }
                    >
                      {a.verdict ? verdictLabel(a.verdict, "submit") : "—"}
                    </span>
                    {a.totalTests !== null && (
                      <span className="text-caption text-body tabular-nums">
                        {a.passedTests ?? 0} of {a.totalTests} tests
                      </span>
                    )}
                    <span className="text-caption text-body">{a.language}</span>
                    <span className="ml-auto text-caption text-body">
                      {formatDateTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-2">
            <h3 className="text-title-sm text-ink">Playback</h3>
            {data.history.length === 0 ? (
              <p className="text-body-sm text-body">
                Nothing was saved while the contest ran. Code is saved as
                it&apos;s typed in the editor, so code that never went through
                it (sent another way) has no history.
              </p>
            ) : (
              <PlaybackView
                history={data.history}
                jumps={data.jumps}
                origin={{ at: data.contest.startsAt, label: "Minute" }}
                marks={data.attempts.map((a) => ({
                  id: a.id,
                  at: a.createdAt,
                  label: `Minute ${minuteOf(a.createdAt, data.contest.startsAt)}${a.verdict ? `: ${verdictLabel(a.verdict, "submit")}` : ""}`,
                }))}
              />
            )}
          </section>
        </>
      )}
    </DetailSheet>
  )
}
