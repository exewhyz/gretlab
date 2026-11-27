"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { PageHeader } from "@/components/page-header"
import { TabButton } from "@/features/lab/components/tab-button"
import { useViewer } from "@/features/account/use-viewer"
import { Card, Loading, Table } from "@/features/admin/components/shell"
import { MySubmissions } from "@/features/submissions/components/my-submissions"
import { ClassChips } from "@/features/classes/components/class-chips"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

import { ContestQuestions } from "./contest-questions"
import { ContestReplay } from "./contest-replay"
import { Countdown } from "./countdown"
import { PhaseBadge } from "./contest-list"
import type { ApiResult } from "@/lib/api/types"
import type { getLeaderboard } from "@/features/contests/server"
import type {
  contestViewWithVirtual,
  virtualLeaderboard,
} from "@/features/contests/virtual"

type ContestView = ApiResult<typeof contestViewWithVirtual>

type Leaderboard = ApiResult<typeof getLeaderboard> &
  Partial<
    Pick<ApiResult<typeof virtualLeaderboard>, "you" | "minute" | "running">
  >

const REFRESH_MS = 15_000
const TABS = ["Problems", "Leaderboard", "My submissions", "Rules"] as const

export function ContestDetail({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const { data: viewer } = useViewer()
  const [tab, setTab] = useState<(typeof TABS)[number]>("Problems")
  const { data: contest, error } = useQuery({
    queryKey: ["contest", slug],
    queryFn: () => api<ContestView>(`/contests/${slug}`),
    refetchInterval: REFRESH_MS,
  })
  // Someone who has taken it virtually sees their own board: the real one at the same minute.
  const inVirtual =
    contest?.virtual?.state === "running" || contest?.virtual?.state === "done"
  const board = useQuery({
    queryKey: ["leaderboard", slug, inVirtual],
    queryFn: () =>
      api<Leaderboard>(
        inVirtual
          ? `/contests/${slug}/virtual/leaderboard`
          : `/contests/${slug}/leaderboard`
      ),
    refetchInterval:
      contest?.phase === "live" || contest?.virtual?.state === "running"
        ? REFRESH_MS
        : false,
    enabled: tab === "Leaderboard",
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["contest", slug] })
    void queryClient.invalidateQueries({ queryKey: ["leaderboard", slug] })
    // What a contest problem allows depends on registering and on the phase.
    void queryClient.invalidateQueries({ queryKey: ["contest-problem", slug] })
  }
  const startVirtual = useMutation({
    mutationFn: () => api(`/contests/${slug}/virtual`, { method: "POST" }),
    onSuccess: refresh,
    meta: { quiet: true },
  })
  const registration = useMutation({
    mutationFn: (register: boolean) =>
      api(`/contests/${slug}/registration`, {
        method: register ? "POST" : "DELETE",
      }),
    onSuccess: refresh,
  })
  const staff =
    viewer?.user?.role === "teacher" || viewer?.user?.role === "admin"

  return (
    <div className="min-h-dvh">
      <PageHeader />
      {/* One column that may shrink: wide tables scroll in their own box, not the page. */}
      <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 p-4 text-body-sm text-body">
        {!contest ? (
          <Loading error={error} />
        ) : (
          <>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-display-lg text-ink">{contest.title}</h1>
                <PhaseBadge
                  phase={contest.phase}
                  published={contest.published}
                />
              </div>
              <ClassChips classes={contest.classes} className="mt-1.5" />
              <p className="mt-1 text-caption">
                {formatDateTime(contest.startsAt)} to{" "}
                {formatDateTime(contest.endsAt)} ·{" "}
                {contest.scoring.toUpperCase()} scoring · {contest.participants}{" "}
                registered
              </p>
              {contest.description && (
                <p className="mt-2 whitespace-pre-wrap">
                  {contest.description}
                </p>
              )}
              {!contest.published && (
                <p className="mt-2 text-caption text-destructive">
                  Draft: only staff can see this. Publish it in the dashboard so
                  students can register.
                </p>
              )}
            </div>

            <Card className="flex flex-wrap items-center gap-3 p-4">
              {contest.phase !== "ended" && (
                <div>
                  <div className="text-caption">
                    {contest.phase === "live" ? "Ends in" : "Starts in"}
                  </div>
                  <div className="text-display-sm text-ink">
                    <Countdown
                      to={
                        contest.phase === "live"
                          ? contest.endsAt
                          : contest.startsAt
                      }
                      onFinish={refresh}
                    />
                  </div>
                </div>
              )}
              {contest.phase === "ended" && (
                <VirtualPanel
                  virtual={contest.virtual}
                  signedIn={Boolean(viewer?.user)}
                  starting={startVirtual.isPending}
                  error={startVirtual.error?.message ?? null}
                  onStart={() => startVirtual.mutate()}
                  onFinish={refresh}
                />
              )}
              <span className="flex-1" />
              {contest.phase !== "ended" &&
                (!viewer?.user ? (
                  <Link
                    href={`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`}
                    className={cn(buttonVariants({ size: "sm" }))}
                  >
                    Sign in to register
                  </Link>
                ) : contest.registered ? (
                  <>
                    <span className="text-success">
                      You&apos;re registered.
                    </span>
                    {contest.phase === "upcoming" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => registration.mutate(false)}
                      >
                        Cancel registration
                      </Button>
                    )}
                  </>
                ) : contest.registrationOpen ? (
                  <Button size="sm" onClick={() => registration.mutate(true)}>
                    Register
                  </Button>
                ) : (
                  <span>Registration is closed.</span>
                ))}
              {staff && (
                <Link
                  href={`/admin/contests/${contest.id}`}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                >
                  Edit
                </Link>
              )}
              {registration.error && (
                <span role="alert" className="w-full text-destructive">
                  {registration.error.message}
                </span>
              )}
            </Card>

            <div>
              <div
                role="tablist"
                className="mb-3 flex flex-wrap border-b border-hairline"
              >
                {TABS.map((name) => (
                  <TabButton
                    key={name}
                    selected={tab === name}
                    onClick={() => setTab(name)}
                  >
                    {name}
                  </TabButton>
                ))}
              </div>

              {tab === "Problems" && (
                <ProblemsTab slug={slug} contest={contest} />
              )}
              {tab === "Leaderboard" &&
                (board.data ? (
                  <LeaderboardTab slug={slug} board={board.data} />
                ) : (
                  <Loading error={board.error} />
                ))}
              {tab === "My submissions" &&
                (viewer?.user ? (
                  <MySubmissions contestSlug={slug} />
                ) : (
                  <p>Sign in to see your submissions.</p>
                ))}
              {tab === "Rules" && <RulesTab contest={contest} />}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function ProblemsTab({
  slug,
  contest,
}: {
  slug: string
  contest: ContestView
}) {
  if (contest.problems.length === 0 && contest.questions.length === 0) {
    return <p>Problems appear when the contest starts.</p>
  }
  return (
    <>
      {contest.problems.length > 0 && (
        <Table headers={["", "Problem", "Level", "Your result"]}>
          {contest.problems.map((problem) => (
            <tr key={problem.label}>
              <td className="w-8 font-semibold">{problem.label}</td>
              <td>
                <Link
                  className="underline-offset-2 hover:underline"
                  href={`/contests/${slug}/problems/${problem.label}`}
                >
                  {problem.title}
                </Link>
              </td>
              <td className="capitalize">{problem.level}</td>
              <td>
                {problem.status === "solved" && (
                  <span className="text-success">Solved</span>
                )}
                {problem.status === "tried" && (
                  <span className="text-destructive">Attempted</span>
                )}
                {!problem.status && <span className="text-body">—</span>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ContestQuestions
        slug={slug}
        questions={contest.questions}
        canAnswer={
          (contest.phase === "live" && contest.registered) ||
          contest.virtual?.state === "running"
        }
      />
    </>
  )
}

function RulesTab({ contest }: { contest: ContestView }) {
  const icpc = contest.scoring === "icpc"
  return (
    <ul className="grid list-disc gap-1.5 pl-5">
      <li>Press Run as often as you like. Only Submit counts.</li>
      {icpc ? (
        <>
          <li>
            A problem is solved when every test passes. More problems solved
            ranks higher.
          </li>
          <li>
            Ties break on penalty: the minutes from the start until each solve,
            plus {contest.penaltyMinutes} minutes for each wrong attempt before
            it. Compile errors cost nothing.
          </li>
        </>
      ) : (
        <li>
          Each test is worth points. Your best score on each problem counts,
          with no penalty for trying again.
        </li>
      )}
      {contest.freezeMinutes > 0 && (
        <li>
          The leaderboard freezes {contest.freezeMinutes} minutes before the
          end. You still see your own results, and everything is revealed when
          the contest ends.
        </li>
      )}
    </ul>
  )
}

function LeaderboardTab({ slug, board }: { slug: string; board: Leaderboard }) {
  const icpc = board.scoring === "icpc"
  // Whoever runs it opens a cell to see how that code was written (./contest-replay.tsx).
  const replayable = new Set(board.you ? [] : (board.replay ?? []))
  const [replay, setReplay] = useState<{
    userId: string
    name: string
    label: string
  } | null>(null)
  // Rated and applied: each contestant's rating change (features/contests/ratings.ts).
  const rated = board.rows.some((row) => "rating" in row && row.rating)
  if (board.rows.length === 0) {
    return <p>Nobody has registered yet.</p>
  }
  return (
    <>
      {board.you && (
        <p className="mb-2 text-caption" data-testid="virtual-board-note">
          {board.running
            ? `Your virtual contest: everyone as they stood at minute ${board.minute}, with you among them.`
            : "Your virtual contest: the final standings, with you among them. The official results don't include you."}
        </p>
      )}
      {board.frozen && (
        <p className="mb-2 text-caption">
          The board is frozen. Results since the freeze show as pending until
          the contest ends.
        </p>
      )}
      <Table
        headers={[
          "#",
          "Name",
          ...(icpc ? ["Solved", "Penalty"] : ["Score"]),
          ...board.problemLabels,
          ...(rated ? ["Rating"] : []),
        ]}
      >
        {board.rows.map((row) => (
          <tr
            key={row.user.id}
            className={cn(
              row.user.id === board.you && "bg-muted/60 font-medium"
            )}
            data-you={row.user.id === board.you ? "" : undefined}
          >
            <td className="tabular-nums">{row.rank}</td>
            <td className="whitespace-nowrap">
              {row.user.name}
              {row.user.id === board.you && (
                <span className="ml-1.5 text-caption text-body">
                  (you, virtual)
                </span>
              )}
            </td>
            {icpc ? (
              <>
                <td className="tabular-nums">{row.solved}</td>
                <td className="tabular-nums">{row.penalty}</td>
              </>
            ) : (
              <td className="tabular-nums">{row.score}</td>
            )}
            {row.problems.map((problem) => {
              const cell = (
                <>
                  {problem.pending > 0 && (
                    <span title="Pending">?{problem.pending} </span>
                  )}
                  {icpc ? (
                    problem.solved ? (
                      <span
                        className="text-success"
                        title={`Solved at ${problem.solvedAtMinutes} min, ${problem.attempts} wrong attempt(s)`}
                      >
                        ✓ {problem.solvedAtMinutes}m
                        {problem.attempts > 0 && ` (+${problem.attempts})`}
                      </span>
                    ) : problem.attempts > 0 ? (
                      <span
                        className="text-destructive"
                        title={`${problem.attempts} wrong attempt(s)`}
                      >
                        −{problem.attempts}
                      </span>
                    ) : null
                  ) : (
                    problem.score || null
                  )}
                </>
              )
              return (
                <td
                  key={problem.label}
                  className="whitespace-nowrap tabular-nums"
                >
                  {replayable.has(problem.label) ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="min-w-10 tabular-nums"
                      aria-label={`How ${row.user.name} wrote ${problem.label}`}
                      onClick={() =>
                        setReplay({
                          userId: row.user.id,
                          name: row.user.name,
                          label: problem.label,
                        })
                      }
                    >
                      {cell}
                    </Button>
                  ) : (
                    cell
                  )}
                </td>
              )
            })}
            {rated && (
              <RatingCell rating={"rating" in row ? row.rating : null} />
            )}
          </tr>
        ))}
      </Table>
      {replayable.size > 0 && (
        <p className="mt-2 text-caption">
          You run this contest: open a cell to see how that code was written.
        </p>
      )}
      {replay && (
        <ContestReplay
          slug={slug}
          {...replay}
          onClose={() => setReplay(null)}
        />
      )}
    </>
  )
}

const VIRTUAL_REASONS: Record<string, string> = {
  took_part_live:
    "You took part in this contest, so it can't be taken virtually.",
}

/**
 * After a contest: taking it virtually, the attempt's clock, or how it went. Shown only to
 * people who could have entered it.
 */
function VirtualPanel({
  virtual,
  signedIn,
  starting,
  error,
  onStart,
  onFinish,
}: {
  virtual: ContestView["virtual"]
  signedIn: boolean
  starting: boolean
  error: string | null
  onStart: () => void
  onFinish: () => void
}) {
  if (!signedIn || !virtual) return <span>This contest has ended.</span>
  if (virtual.state === "running")
    return (
      <div data-testid="virtual-running">
        <div className="text-caption">Your virtual contest ends in</div>
        <div className="text-display-sm text-ink">
          <Countdown to={virtual.endsAt} onFinish={onFinish} />
        </div>
      </div>
    )
  if (virtual.state === "done")
    return (
      <span data-testid="virtual-result">
        This contest has ended. Your virtual contest:{" "}
        {virtual.result ? (
          <b className="text-ink">
            {ordinal(virtual.result.rank)} of {virtual.result.of}
          </b>
        ) : (
          "finished"
        )}
        {virtual.result &&
          (virtual.result.scoring === "icpc"
            ? ` · ${virtual.result.solved} solved · penalty ${virtual.result.penalty}`
            : ` · ${virtual.result.score} points`)}
        .
      </span>
    )
  if (virtual.state === "unavailable")
    return (
      <span>
        This contest has ended.{" "}
        {virtual.reason && VIRTUAL_REASONS[virtual.reason]}
      </span>
    )
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="virtual-offer"
    >
      <span className="max-w-xl">
        This contest has ended. Take it virtually: {virtual.lengthMinutes}{" "}
        minutes on your own clock, ranked against everyone as they stood at each
        minute. Once only; the official results don&apos;t change.
      </span>
      <ConfirmStart
        minutes={virtual.lengthMinutes ?? 0}
        starting={starting}
        onStart={onStart}
      />
      {error && (
        <span role="alert" className="w-full text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}

function ConfirmStart({
  minutes,
  starting,
  onStart,
}: {
  minutes: number
  starting: boolean
  onStart: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" disabled={starting} onClick={() => setOpen(true)}>
        Take it virtually
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start your virtual contest now?</AlertDialogTitle>
            <AlertDialogDescription>
              The clock starts at once and runs for {minutes} minutes, even if
              you leave the page. You can take it only once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false)
                onStart()
              }}
            >
              Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ordinal(n: number) {
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][n % 10] ?? "th")
  return `${n}${s}`
}

/** A contestant's rating after a rated contest, and how much it moved. */
function RatingCell({
  rating,
}: {
  rating: { before: number; after: number } | null
}) {
  if (!rating) return <td className="text-body">—</td>
  const change = rating.after - rating.before
  return (
    <td className="whitespace-nowrap tabular-nums">
      {rating.after}{" "}
      <span
        className={cn(
          change > 0 && "text-success",
          change < 0 && "text-destructive"
        )}
      >
        ({change > 0 ? `+${change}` : change})
      </span>
    </td>
  )
}
