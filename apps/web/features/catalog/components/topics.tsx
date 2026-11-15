import Link from "next/link"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"

import type { Level, TopicProblem, TopicSummary } from "../topics"
import { Difficulty, TagChip } from "./difficulty"

/*
 * The topic pages: what search engines land on for "string problems" and the like, and a
 * way for people to browse the library by subject. Built for reading and scanning: a
 * hairline list, each problem with its level and the opening of its statement.
 */

const LEVELS: Level[] = ["easy", "medium", "hard"]

/** "3 problems · 1 easy, 1 medium, 1 hard" */
export function levelLine(count: number, levels: Record<Level, number>) {
  const parts = LEVELS.filter((l) => levels[l] > 0).map((l) => `${levels[l]} ${l}`)
  return `${count} ${count === 1 ? "problem" : "problems"} · ${parts.join(", ")}`
}

function Crumbs({ topic }: { topic?: string }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href="/problems" />}>Problems</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {topic ? (
            <BreadcrumbLink render={<Link href="/problems/topics" />}>Topics</BreadcrumbLink>
          ) : (
            <BreadcrumbPage>Topics</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {topic && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{topic}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** /problems/topics: every topic with how many problems it has at each level. */
export function TopicIndex({ topics, languages }: { topics: TopicSummary[]; languages: string }) {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-6">
      <Crumbs />
      <h1 className="mt-4 text-display-lg text-balance text-ink">Coding problems by topic</h1>
      <p className="mt-3 max-w-[65ch] text-body-md text-body">
        Pick a topic to practise. Each one runs from easy to hard, and every problem can be
        solved in {languages}, right in your browser.
      </p>
      {topics.length === 0 ? (
        <p className="mt-10 text-body-md text-muted-foreground">
          No topics yet. Problems appear here once they&apos;re tagged.{" "}
          <Link href="/problems" className="text-ink underline underline-offset-2">
            See every problem
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mt-8 border-b border-hairline pb-3 text-caption text-muted-foreground tabular-nums">
            {topics.length} {topics.length === 1 ? "topic" : "topics"}
          </p>
          <ul className="grid sm:grid-cols-2 sm:gap-x-10">
            {topics.map((t) => (
              <li key={t.slug} className="border-b border-hairline">
                <Link
                  href={`/problems/topics/${t.slug}`}
                  className="group grid gap-1 py-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="text-title-sm text-ink group-hover:underline">{t.name}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {levelLine(t.count, t.levels)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}

/** /problems/topics/<topic>: its problems, easiest first, then the other topics. */
export function TopicPage({
  topic,
  problems,
  others,
  languages,
}: {
  topic: TopicSummary
  problems: TopicProblem[]
  others: TopicSummary[]
  languages: string
}) {
  const first = problems[0]
  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-6">
      <Crumbs topic={topic.name} />
      <h1 className="mt-4 text-display-lg text-balance text-ink">{topic.name}</h1>
      <p className="mt-2 text-caption text-muted-foreground tabular-nums">
        {levelLine(topic.count, topic.levels)}
      </p>
      <p className="mt-4 max-w-[65ch] text-body-md text-body">
        Practice problems on {topic.name.toLowerCase()}, easiest first. Solve them in{" "}
        {languages} in your browser: run your code on the examples, then submit it to be
        checked against every test.
        {first && (
          <>
            {" "}
            New to it? Start with{" "}
            <Link href={`/problems/${first.slug}`} className="text-ink underline underline-offset-2">
              {first.title}
            </Link>
            .
          </>
        )}
      </p>

      <ol className="mt-8 border-t border-hairline">
        {problems.map((p) => (
          <li key={p.slug} className="grid gap-1.5 border-b border-hairline py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Link
                href={`/problems/${p.slug}`}
                className="text-title-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {p.title}
              </Link>
              <span className="flex items-baseline gap-3 text-caption tabular-nums">
                <Difficulty level={p.level} />
                {p.acceptance !== null && (
                  <span className="text-muted-foreground">
                    {Math.round(p.acceptance * 100)}% accepted
                  </span>
                )}
              </span>
            </div>
            {p.summary && <p className="max-w-[70ch] text-body-sm text-body">{p.summary}</p>}
            {p.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {p.tags.map((t) => (
                  <TagChip key={t.slug} name={t.name} href={`/problems/topics/${t.slug}`} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      {others.length > 0 && (
        <section aria-labelledby="more-topics" className="mt-12">
          <h2 id="more-topics" className="text-title-md text-ink">
            More topics
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {others.map((t) => (
              <TagChip key={t.slug} name={`${t.name} (${t.count})`} href={`/problems/topics/${t.slug}`} />
            ))}
          </div>
          <p className="mt-6 text-body-sm">
            <Link href="/problems/topics" className="text-ink underline underline-offset-2">
              All topics
            </Link>
            <span aria-hidden="true"> · </span>
            <Link href="/problems" className="text-ink underline underline-offset-2">
              Every problem
            </Link>
          </p>
        </section>
      )}
    </main>
  )
}
