import { getDb, problems, sql } from "@workspace/db"

import { clip, plainText } from "@/lib/seo/text"

import { getCatalog, type CatalogProblem } from "./server"

const { inArray } = sql

/*
 * Topic pages (/problems/topics, /problems/topics/<tag>): every public problem with a tag,
 * gathered by tag, for people searching "string problems" or "recursion practice". Built
 * from the library's own catalog, so a topic shows exactly the problems the library does,
 * and appears once it has one. No separate content to keep up: problems, levels and
 * openings come from the problems themselves.
 */

export type Level = CatalogProblem["level"]

export interface TopicSummary {
  slug: string
  name: string
  count: number
  levels: Record<Level, number>
}

export interface TopicProblem {
  slug: string
  title: string
  level: Level
  /** The opening of its statement, as plain text. */
  summary: string
  /** Other topics it's tagged with. */
  tags: { slug: string; name: string }[]
  acceptance: number | null
}

const LEVELS: Level[] = ["easy", "medium", "hard"]

function levelsOf(list: { level: Level }[]) {
  const levels = { easy: 0, medium: 0, hard: 0 }
  for (const p of list) levels[p.level] += 1
  return levels
}

/** Every topic with at least one public problem, most problems first. */
export async function listTopics(): Promise<TopicSummary[]> {
  const { problems: all, tags } = await getCatalog()
  return tags
    .map((tag) => {
      const inTopic = all.filter((p) => p.tags.some((t) => t.slug === tag.slug))
      return { slug: tag.slug, name: tag.name, count: inTopic.length, levels: levelsOf(inTopic) }
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** One topic: its problems, easiest first, with their openings; and the other topics. */
export async function getTopic(slug: string) {
  const [{ problems: all }, topics] = await Promise.all([getCatalog(), listTopics()])
  const topic = topics.find((t) => t.slug === slug)
  if (!topic) return null
  const inTopic = all
    .filter((p) => p.tags.some((t) => t.slug === slug))
    .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.no - b.no)
  const openings = new Map(
    (
      await getDb()
        .select({ slug: problems.slug, description: problems.description })
        .from(problems)
        .where(inArray(problems.slug, inTopic.map((p) => p.id)))
    ).map((r) => [r.slug, clip(plainText(r.description), 160)])
  )
  const list: TopicProblem[] = inTopic.map((p) => ({
    slug: p.id,
    title: p.title,
    level: p.level,
    summary: openings.get(p.id) ?? "",
    tags: p.tags.filter((t) => t.slug !== slug),
    acceptance: p.acceptance,
  }))
  return {
    topic,
    problems: list,
    others: topics.filter((t) => t.slug !== slug),
  }
}
