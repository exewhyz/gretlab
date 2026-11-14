"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

import { useContentScope } from "@/features/account/scope"
import { ScopeNote } from "@/features/account/scope-switcher"
import { useViewer } from "@/features/account/use-viewer"
import { Card, Loading, Stats, Table } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDate } from "@/lib/format"

import { Difficulty } from "./difficulty"
import { Heatmap } from "./heatmap"
import type { ApiResult } from "@/lib/api/types"
import type { getProfile } from "@/features/catalog/server"
import type { getLeaderboard } from "@/features/catalog/server"

type Profile = ApiResult<typeof getProfile>

function Bar({ value, total }: { value: number; total: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-strong">
      <div
        className="h-full bg-success"
        style={{ width: `${total ? (100 * value) / total : 0}%` }}
      />
    </div>
  )
}

export function ProfileView({ handle }: { handle: string }) {
  const { data, error } = useQuery({
    queryKey: ["profile", handle],
    queryFn: () => api<Profile>(`/users/${handle}`),
  })
  if (!data) return <Loading error={error} />
  const levels = ["easy", "medium", "hard"] as const
  return (
    <div className="grid gap-4 text-body-sm text-body">
      <div>
        <h1 className="text-display-lg text-ink">{data.name}</h1>
        <p className="text-caption">
          @{data.handle} · joined{" "}
          {new Date(data.joinedAt).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
      <div className="grid gap-3 min-[901px]:grid-cols-3">
        <Card>
          <div
            data-testid="solved-count"
            className="text-display-md text-ink tabular-nums"
          >
            {data.solved}
          </div>
          <div className="text-caption">problems solved</div>
          <div className="mt-3 grid gap-2">
            {levels.map((level) => (
              <div key={level}>
                <div className="flex justify-between text-caption">
                  <Difficulty level={level} />
                  <span className="tabular-nums">
                    {data.solvedBy[level]} / {data.totalBy[level]}
                  </span>
                </div>
                <Bar value={data.solvedBy[level]} total={data.totalBy[level]} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div
            data-testid="current-streak"
            className="text-display-md text-ink tabular-nums"
          >
            {data.streak.current}
          </div>
          <div className="text-caption">day streak now</div>
          <div className="mt-3 text-caption">
            Longest: <b className="text-ink">{data.streak.longest}</b> days
          </div>
        </Card>
        <Card>
          <div className="mb-2 text-title-sm text-ink">
            Badges ({data.badges.length})
          </div>
          {data.badges.length === 0 ? (
            <p className="text-caption">Solve a first problem to earn one.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {data.badges.map((badge) => (
                <li
                  key={badge.id}
                  title={badge.description}
                  className="rounded-full border border-hairline bg-canvas-soft px-2.5 py-1 text-xs text-ink"
                >
                  {badge.name}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <h2 className="mb-2 text-title-sm text-ink">Activity</h2>
        <Heatmap counts={data.heatmap} today={data.today} />
      </Card>
      <div className="grid gap-4 min-[901px]:grid-cols-2">
        <div>
          <h2 className="mb-2 text-title-sm text-ink">Recently solved</h2>
          {data.recent.length === 0 ? (
            <p>Nothing yet.</p>
          ) : (
            <Table headers={["Problem", "When"]}>
              {data.recent.map((item) => (
                <tr key={item.slug}>
                  <td>
                    <Link
                      href={`/problems/${item.slug}`}
                      className="hover:underline"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{formatDate(item.at)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <div>
          <h2 className="mb-2 text-title-sm text-ink">Contests</h2>
          {data.contests.length === 0 ? (
            <p>No contests yet.</p>
          ) : (
            <Table headers={["Contest", "Date"]}>
              {data.contests.map((contest) => (
                <tr key={contest.slug}>
                  <td>
                    <Link
                      href={`/contests/${contest.slug}`}
                      className="hover:underline"
                    >
                      {contest.title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">
                    {formatDate(contest.startsAt)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The leaderboard for the header's organization switcher: everything, the chosen
 * organizations' members who share their practice with them. Rows never name anyone's
 * organization.
 */
export function GlobalLeaderboard() {
  const { data: viewer } = useViewer()
  const { scope } = useContentScope()
  const param = scope?.join(",") ?? ""
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ["leaderboard", "global", param],
    queryFn: () =>
      api<ApiResult<typeof getLeaderboard>>(
        `/leaderboard${param ? `?scope=${encodeURIComponent(param)}` : ""}`
      ),
    placeholderData: keepPreviousData,
  })
  if (!data) return <Loading error={error} />
  const rows = data.rows
  const me = viewer?.user?.handle
  const mine = rows.find((r) => r.handle === me)
  return (
    <>
      <h1 className="mb-1 text-display-lg text-ink">Leaderboard</h1>
      <p className="mb-4 text-caption text-body">
        {data.scope
          ? "Members who share their practice with the organizations chosen in the header, ranked by problems solved, those organizations' own problems included."
          : "Students ranked by problems solved."}{" "}
        Updates every minute.
      </p>
      <ScopeNote hidden={0} />
      {rows.length > 0 && (
        <Stats
          items={[
            { label: "On the board", value: rows.length },
            {
              label: "Your rank",
              value: mine ? `#${mine.rank}` : "—",
              hint: mine ? `${mine.solved} solved` : "Solve a problem to join",
            },
            { label: "Most solved", value: rows[0]!.solved },
          ]}
        />
      )}
      {rows.length === 0 ? (
        <p className="text-body-sm text-body">
          {data.scope
            ? "Nobody here is on the board yet. It lists members who chose to share their practice with their organization, from its page."
            : "Nobody has solved a problem yet."}
        </p>
      ) : (
        <div className={cn(isPlaceholderData && "opacity-60")}>
          <Table headers={["#", "Student", "Solved"]}>
            {rows.map((row) => (
              <tr
                key={row.handle}
                data-testid="leaderboard-row"
                aria-current={row.handle === me ? "true" : undefined}
                className={cn(row.handle === me && "bg-primary/10 font-medium")}
              >
                <td className="w-12 tabular-nums">{row.rank}</td>
                <td>
                  <Link href={`/u/${row.handle}`} className="hover:underline">
                    {row.name}
                  </Link>{" "}
                  <span className="text-xs text-body">@{row.handle}</span>
                  {row.handle === me && (
                    <span className="ml-2 rounded-full bg-primary px-1.5 py-px text-xs text-primary-foreground">
                      You
                    </span>
                  )}
                </td>
                <td className="tabular-nums">{row.solved}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </>
  )
}
