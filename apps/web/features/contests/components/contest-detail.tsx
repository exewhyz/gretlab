"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

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

import { ContestQuestions, type ContestQuestion } from "./contest-questions"
import { Countdown } from "./countdown"
import { PhaseBadge } from "./contest-list"

interface ContestView {
  classes: { name: string; href: string }[]
  id: string
  title: string
  description: string
  startsAt: string
  endsAt: string
  scoring: "icpc" | "ioi"
  penaltyMinutes: number
  freezeMinutes: number
  phase: "upcoming" | "live" | "ended"
  published: boolean
  participants: number
  registered: boolean
  registrationOpen: boolean
  problems: {
    id: string
    label: string
    title: string
    level: string
    status: "solved" | "tried" | null
  }[]
  questions: ContestQuestion[]
}

interface Leaderboard {
  scoring: "icpc" | "ioi"
  problemLabels: string[]
  frozen: boolean
  rows: {
    rank: number
    user: { id: string; name: string }
    solved: number
    penalty: number
    score: number
    problems: {
      label: string
      solved: boolean
      attempts: number
      solvedAtMinutes: number | null
      score: number
      pending: number
    }[]
  }[]
}

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
  const board = useQuery({
    queryKey: ["leaderboard", slug],
    queryFn: () => api<Leaderboard>(`/contests/${slug}/leaderboard`),
    refetchInterval: contest?.phase === "live" ? REFRESH_MS : false,
    enabled: tab === "Leaderboard",
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["contest", slug] })
    void queryClient.invalidateQueries({ queryKey: ["leaderboard", slug] })
    // What a contest problem allows depends on registering and on the phase.
    void queryClient.invalidateQueries({ queryKey: ["contest-problem", slug] })
  }
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
      <main className="mx-auto grid max-w-5xl gap-4 p-4 text-body-sm text-body">
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
                <span>This contest has ended.</span>
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
                  <LeaderboardTab board={board.data} />
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
      canAnswer={contest.phase === "live" && contest.registered}
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

function LeaderboardTab({ board }: { board: Leaderboard }) {
  const icpc = board.scoring === "icpc"
  if (board.rows.length === 0) {
    return <p>Nobody has registered yet.</p>
  }
  return (
    <>
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
        ]}
      >
        {board.rows.map((row) => (
          <tr key={row.user.id}>
            <td className="tabular-nums">{row.rank}</td>
            <td className="whitespace-nowrap">{row.user.name}</td>
            {icpc ? (
              <>
                <td className="tabular-nums">{row.solved}</td>
                <td className="tabular-nums">{row.penalty}</td>
              </>
            ) : (
              <td className="tabular-nums">{row.score}</td>
            )}
            {row.problems.map((problem) => (
              <td
                key={problem.label}
                className="whitespace-nowrap tabular-nums"
              >
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
              </td>
            ))}
          </tr>
        ))}
      </Table>
    </>
  )
}
