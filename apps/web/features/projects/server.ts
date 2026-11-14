import { forUsers, type Who } from "@/lib/for-users"
import {
  assignmentProjects,
  getDb,
  projectSubmissions,
  sql,
  type User,
} from "@workspace/db"
import { isCommitSha, parseRepo } from "@workspace/judge"

import { ApiError } from "@/lib/api/route"

/*
 * Projects: assignment work handed in as a GitHub repository and marked by a teacher.
 * A submission is pinned to the commit its branch was at when handed in (looked up on
 * GitHub), so later pushes don't change what's marked. Marks count in the assignment's
 * total like quiz marks; students see theirs unless results are held.
 */

const { and, asc, eq, inArray } = sql

export type Project = typeof assignmentProjects.$inferSelect

export function projectsOf(assignmentIds: string[]) {
  if (assignmentIds.length === 0) return Promise.resolve([] as Project[])
  return getDb()
    .select()
    .from(assignmentProjects)
    .where(inArray(assignmentProjects.assignmentId, assignmentIds))
    .orderBy(asc(assignmentProjects.position))
}

export function projectSubmissionsOn(projectIds: string[], userId?: Who) {
  if (projectIds.length === 0)
    return Promise.resolve([] as (typeof projectSubmissions.$inferSelect)[])
  return getDb()
    .select()
    .from(projectSubmissions)
    .where(
      and(
        inArray(projectSubmissions.projectId, projectIds),
        forUsers(projectSubmissions.userId, userId)
      )
    )
}

export interface ProjectGrade {
  earned: number
  max: number
  submitted: number
  needsMarking: number
}

/** Per assignment and student: project marks, how many handed in, how many wait for marking. */
export async function projectGrades(assignmentIds: string[], userId?: Who) {
  const projects = await projectsOf(assignmentIds)
  const subs = await projectSubmissionsOn(
    projects.map((p) => p.id),
    userId
  )
  const max = new Map<string, number>()
  for (const p of projects)
    max.set(p.assignmentId, (max.get(p.assignmentId) ?? 0) + p.points)
  const grade = (assignmentId: string, student: string): ProjectGrade => {
    const own = projects.filter((p) => p.assignmentId === assignmentId)
    const mine = subs.filter(
      (s) => s.userId === student && own.some((p) => p.id === s.projectId)
    )
    return {
      earned: mine.reduce((n, s) => n + (s.mark ?? 0), 0),
      max: max.get(assignmentId) ?? 0,
      submitted: mine.length,
      needsMarking: mine.filter((s) => s.mark === null).length,
    }
  }
  return {
    projects,
    submissions: subs,
    max: (id: string) => max.get(id) ?? 0,
    grade,
  }
}

/** Saves an assignment's projects, keeping ids (and so submissions) for ones still there. */
export async function saveProjects(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  assignmentId: string,
  input: { id?: string; title: string; instructions: string; points: number }[]
) {
  const existing = await tx
    .select({ id: assignmentProjects.id })
    .from(assignmentProjects)
    .where(eq(assignmentProjects.assignmentId, assignmentId))
  const known = new Set(existing.map((p) => p.id))
  const kept = new Set<string>()
  for (const [position, p] of input.entries()) {
    const values = {
      title: p.title,
      instructions: p.instructions,
      points: p.points,
      position,
    }
    if (p.id && known.has(p.id) && !kept.has(p.id)) {
      await tx
        .update(assignmentProjects)
        .set(values)
        .where(eq(assignmentProjects.id, p.id))
      kept.add(p.id)
    } else {
      const [row] = await tx
        .insert(assignmentProjects)
        .values({ ...values, assignmentId })
        .returning()
      kept.add(row!.id)
    }
  }
  const gone = [...known].filter((id) => !kept.has(id))
  if (gone.length)
    await tx
      .delete(assignmentProjects)
      .where(inArray(assignmentProjects.id, gone))
}

/**
 * The commit a branch (or the default branch) points at now, from GitHub's API. Null when
 * GitHub can't be reached or lookups are off (`GITHUB_LOOKUP=off`); "missing" when GitHub
 * says there's no such repository or branch (or it's private).
 */
async function resolveCommit(owner: string, repo: string, ref: string | null) {
  if (process.env.GITHUB_LOOKUP === "off") return null
  const path = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref ?? "HEAD")}`
  try {
    const res = await fetch(path, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "gretlab",
        ...(process.env.GITHUB_TOKEN
          ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      signal: AbortSignal.timeout(4000),
      redirect: "error",
    })
    if (res.status === 404 || res.status === 422) return "missing" as const
    if (!res.ok) return null
    const body = (await res.json()) as { sha?: string }
    return body.sha && isCommitSha(body.sha) ? body.sha : null
  } catch {
    return null
  }
}

/** Checks and pins a repository link for handing in. */
export async function checkRepository(link: string) {
  const repo = parseRepo(link)
  if (!repo) {
    throw new ApiError(
      400,
      "bad_repository",
      "Use your GitHub repository's link, like https://github.com/you/project."
    )
  }
  if (repo.commit) return { ...repo, sha: repo.commit }
  const sha = await resolveCommit(repo.owner, repo.repo, repo.ref)
  if (sha === "missing") {
    throw new ApiError(
      400,
      "repository_not_found",
      repo.ref
        ? `GitHub has no branch "${repo.ref}" in ${repo.owner}/${repo.repo}, or the repository is private.`
        : `GitHub can't find ${repo.owner}/${repo.repo}. Check the link, and make the repository public (or invite your teacher).`
    )
  }
  return { ...repo, sha }
}

export type { User }
