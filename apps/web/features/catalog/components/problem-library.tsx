"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useMemo, useState } from "react"

import { ScrollX } from "@workspace/ui/components/scroll-x"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"

import { byName } from "@/lib/by-name"
import { SelectInput, TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { useProgress } from "@/features/lab/hooks/use-progress"
import { useContentScope } from "@/features/account/scope"
import { ScopeNote } from "@/features/account/scope-switcher"
import { api } from "@/lib/api/client"

import type { CatalogProblem } from "../server"
import { DailyQuestion, type DailyQuestionData } from "./daily-question"
import { Difficulty, TagChip } from "./difficulty"
import type { ApiResult } from "@/lib/api/types"
import type { getLists } from "@/features/catalog/server"
import type { getCatalog } from "@/features/catalog/server"
import { formatDay } from "@/lib/format"

type Catalog = ApiResult<typeof getCatalog>

interface Daily {
  day: string
  problem: { slug: string; title: string; level: string } | null
  solvedToday: boolean
  streak: number
  questions: DailyQuestionData[]
}

type ListSummary = ApiResult<typeof getLists>[number]

const PAGE = 50
const LEVEL_ORDER = { easy: 0, medium: 1, hard: 2 } as const
type Sort =
  "default" | "title" | "difficulty" | "acceptance-high" | "acceptance-low"

function DailyCard({ daily, signedIn }: { daily: Daily; signedIn: boolean }) {
  return (
    <div
      className="grid gap-2 rounded-lg border border-hairline bg-card p-4"
      data-testid="daily-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-caption-upper text-body uppercase">
          Daily challenge · {formatDay(daily.day)}
        </div>
        {daily.streak > 0 && (
          <span data-testid="streak" className="text-caption text-ink">
            🔥 {daily.streak}-day streak
          </span>
        )}
      </div>
      {daily.problem && (
        <Link href={`/problems/${daily.problem.slug}`} className="group block">
          <div className="text-title-md text-ink group-hover:underline">
            {daily.problem.title}
          </div>
          <div className="mt-1 flex items-center gap-3 text-caption">
            <Difficulty level={daily.problem.level} />
            {daily.solvedToday ? (
              <span className="text-success">Solved today</span>
            ) : (
              <span>Not solved yet today</span>
            )}
          </div>
        </Link>
      )}
      {daily.questions.length > 0 && (
        <Collapsible
          className="grid gap-2"
          defaultOpen={daily.questions.some((q) => !q.answer)}
          data-testid="daily-questions"
        >
          <CollapsibleTrigger className="justify-self-start text-caption text-body hover:text-ink">
            {daily.questions.length}{" "}
            {daily.questions.length === 1 ? "question" : "questions"} today ·{" "}
            {daily.questions.filter((q) => q.answer?.correct).length} right of{" "}
            {daily.questions.filter((q) => q.answer).length} answered
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-2">
            {daily.questions.map((q, index) => (
              <DailyQuestion
                key={q.id}
                q={q}
                number={index + 1}
                signedIn={signedIn}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export function ProblemLibrary({ initial }: { initial: Catalog }) {
  const { data: viewer } = useViewer()
  const progress = useProgress()
  const { data: catalog } = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<Catalog>("/catalog"),
    initialData: initial,
    staleTime: 60_000,
  })
  const { data: daily } = useQuery({
    queryKey: ["daily"],
    queryFn: () => api<Daily | null>("/daily"),
    enabled: Boolean(viewer?.features.daily),
  })
  const { data: lists } = useQuery({
    queryKey: ["lists"],
    queryFn: () => api<ListSummary[]>("/lists"),
    enabled: Boolean(viewer?.features.lists),
  })

  // Only the places chosen in the header's switcher.
  const { shows } = useContentScope()
  const problems = useMemo(
    () => catalog.problems.filter((p) => shows(p.org)),
    [catalog.problems, shows]
  )

  const [search, setSearch] = useState("")
  const [level, setLevel] = useState("")
  const [status, setStatus] = useState("")
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [sort, setSort] = useState<Sort>("default")
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rows = problems.filter((problem) => {
      const state = progress[problem.id] ?? "todo"
      return (
        (!query ||
          problem.title.toLowerCase().includes(query) ||
          String(problem.no) === query) &&
        (!level || problem.level === level) &&
        (!status || state === status) &&
        activeTags.every((tag) => problem.tags.some((t) => t.slug === tag))
      )
    })
    const byAcceptance = (problem: CatalogProblem) => problem.acceptance ?? -1
    const sorted = [...rows]
    if (sort === "title") sorted.sort((a, b) => byName(a.title, b.title))
    if (sort === "difficulty") {
      sorted.sort(
        (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.no - b.no
      )
    }
    if (sort === "acceptance-high")
      sorted.sort((a, b) => byAcceptance(b) - byAcceptance(a))
    if (sort === "acceptance-low")
      sorted.sort((a, b) => byAcceptance(a) - byAcceptance(b))
    return sorted
  }, [problems, search, level, status, activeTags, sort, progress])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const solvedCount = problems.filter((p) => progress[p.id] === "solved").length
  const reset = () => setPage(0)
  const toggleTag = (slug: string) => {
    setActiveTags((current) =>
      current.includes(slug)
        ? current.filter((t) => t !== slug)
        : [...current, slug]
    )
    reset()
  }
  const studyPlans = lists?.filter((list) => list.kind === "study_plan") ?? []
  const upNext =
    problems.find((p) => progress[p.id] === "tried") ??
    problems.find((p) => !progress[p.id])

  return (
    <div className="mx-auto grid max-w-7xl gap-5 p-4 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-display-lg text-ink">Problems</h1>
            <div className="mt-1 flex items-center gap-2.5 text-caption text-body tabular-nums">
              <div
                aria-hidden
                className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-strong"
              >
                <div
                  className="h-full bg-success"
                  style={{
                    width: `${(100 * solvedCount) / Math.max(1, problems.length)}%`,
                  }}
                />
              </div>
              {solvedCount} of {problems.length} solved
            </div>
          </div>
        </div>

        <ScopeNote hidden={catalog.problems.length - problems.length} />
        <div className="mb-3 flex flex-wrap gap-2">
          <TextInput
            aria-label="Search problems"
            placeholder="Search by title or number"
            className="w-64"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              reset()
            }}
          />
          <SelectInput
            aria-label="Difficulty"
            className="w-36"
            value={level}
            onChange={(event) => {
              setLevel(event.target.value)
              reset()
            }}
          >
            <option value="">Any difficulty</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </SelectInput>
          <SelectInput
            aria-label="Status"
            className="w-36"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              reset()
            }}
          >
            <option value="">Any status</option>
            <option value="todo">To do</option>
            <option value="tried">Attempted</option>
            <option value="solved">Solved</option>
          </SelectInput>
          <SelectInput
            aria-label="Sort"
            className="w-44"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            <option value="default">Course order</option>
            <option value="title">Title</option>
            <option value="difficulty">Difficulty</option>
            <option value="acceptance-high">Acceptance: high first</option>
            <option value="acceptance-low">Acceptance: low first</option>
          </SelectInput>
          {(search || level || status || activeTags.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto"
              onClick={() => {
                setSearch("")
                setLevel("")
                setStatus("")
                setActiveTags([])
                reset()
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {catalog.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Topics">
            {catalog.tags.map((tag) => (
              <TagChip
                key={tag.slug}
                name={`${tag.name} · ${tag.count}`}
                active={activeTags.includes(tag.slug)}
                onClick={() => toggleTag(tag.slug)}
              />
            ))}
          </div>
        )}

        <ScrollX className="overflow-hidden rounded-lg border border-hairline bg-card">
          <table className="w-full text-left text-body-sm text-ink">
            <thead>
              <tr className="border-b border-hairline text-caption-upper text-body uppercase">
                <th className="w-16 px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Title</th>
                <th className="w-28 px-3 py-2.5 max-sm:hidden">Acceptance</th>
                <th className="w-24 px-3 py-2.5">Difficulty</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((problem) => {
                const state = progress[problem.id]
                return (
                  <tr
                    key={problem.id}
                    data-testid="problem-row"
                    className="border-t border-hairline-soft hover:bg-muted"
                  >
                    <td className="px-3 py-2">
                      {state === "solved" && (
                        <span title="Solved" className="text-success">
                          ✓
                        </span>
                      )}
                      {state === "tried" && (
                        <span
                          title="Attempted, not solved yet"
                          className="text-primary"
                        >
                          ●
                        </span>
                      )}
                      {!state && (
                        <span title="Not started" className="text-muted-soft">
                          ○
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/problems/${problem.id}`}
                        className="hover:underline"
                      >
                        {problem.no}. {problem.title}
                      </Link>
                      {problem.by && (
                        <span className="ml-2 text-xs text-body">
                          by {problem.by}
                        </span>
                      )}
                      {problem.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {problem.tags.map((tag) => (
                            <TagChip key={tag.slug} name={tag.name} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td
                      className="px-3 py-2 text-body tabular-nums max-sm:hidden"
                      title={
                        problem.acceptance === null
                          ? "Nobody has submitted this yet"
                          : "Share of graded submissions that were accepted"
                      }
                    >
                      {problem.acceptance === null
                        ? "—"
                        : `${Math.round(problem.acceptance * 100)}%`}
                    </td>
                    <td className="px-3 py-2">
                      <Difficulty level={problem.level} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="p-4 text-body-sm text-body">
              No problems match these filters.
            </p>
          )}
        </ScrollX>
        {pages > 1 && (
          <div className="mt-3 flex items-center gap-2 text-caption">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span className="tabular-nums">
              Page {page + 1} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      <aside className="grid content-start gap-4">
        {upNext && (
          <Link
            href={`/problems/${upNext.id}`}
            data-testid="up-next"
            className="block rounded-lg border border-hairline bg-card p-4 hover:border-hairline-strong"
          >
            <div className="text-caption-upper text-body uppercase">
              {progress[upNext.id] === "tried" ? "Continue" : "Up next"}
            </div>
            <div className="mt-1 text-title-md text-ink">
              {upNext.no}. {upNext.title}
            </div>
            <div className="mt-1 flex items-center gap-3 text-caption">
              <Difficulty level={upNext.level} />
              <span className="text-primary">Open →</span>
            </div>
          </Link>
        )}
        {daily && <DailyCard daily={daily} signedIn={Boolean(viewer?.user)} />}
        {solvedCount === 0 && (
          <div className="rounded-lg border border-hairline bg-card p-4 text-body-sm text-body">
            <h2 className="mb-2 text-title-sm text-ink">How it works</h2>
            <ol className="grid list-decimal gap-1.5 pl-5">
              <li>Open a problem and read what it asks for.</li>
              <li>
                Write your code, then press <b className="text-ink">Run</b> to
                try it on the sample cases.
              </li>
              <li>
                Press <b className="text-ink">Submit</b> to be graded on every
                test, including hidden ones.
              </li>
            </ol>
            {!viewer?.user && viewer && (
              <p className="mt-3">
                <Link
                  href="/sign-in?callbackUrl=%2Fproblems"
                  className="text-ink underline underline-offset-2"
                >
                  Sign in
                </Link>{" "}
                to submit and keep your progress.
              </p>
            )}
          </div>
        )}
        {studyPlans.length > 0 && (
          <div className="rounded-lg border border-hairline bg-card p-4">
            <h2 className="mb-2 text-title-sm text-ink">Study plans</h2>
            <ul className="grid gap-2">
              {studyPlans.map((plan) => (
                <li key={plan.slug}>
                  <Link
                    href={`/lists/${plan.slug}`}
                    className="text-ink hover:underline"
                  >
                    {plan.title}
                  </Link>
                  <div className="text-xs text-body">{plan.size} problems</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {viewer?.user && viewer.features.lists && (
          <Link
            href="/lists"
            className={cn(
              "rounded-lg border border-hairline bg-card p-4 text-body-sm text-ink hover:border-hairline-strong"
            )}
          >
            My lists and favorites →
          </Link>
        )}
      </aside>
    </div>
  )
}
