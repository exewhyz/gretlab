"use client"

import { GithubLogoIcon } from "@phosphor-icons/react"

import { formatDateTime } from "@/lib/format"

/** A repository as handed in: at its pinned commit, else the branch, else the repository. */
export const atCommit = (s: {
  repoUrl: string
  commitSha: string | null
  ref?: string | null
}) =>
  s.commitSha
    ? `${s.repoUrl}/tree/${s.commitSha}`
    : s.ref
      ? `${s.repoUrl}/tree/${s.ref}`
      : s.repoUrl

/**
 * What was handed in for a project (an assignment's or a course checkpoint's): the repository
 * opened at the commit it was pinned to, when, and whether it was late or couldn't be pinned.
 * One display for both, so they read the same.
 */
export function HandedInRepo({
  submission: s,
}: {
  submission: {
    repoUrl: string
    commitSha: string | null
    ref?: string | null
    submittedAt: string | Date
    late?: boolean
  }
}) {
  return (
    <>
      <a
        href={atCommit(s)}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex flex-wrap items-center gap-1.5 text-ink underline-offset-2 hover:underline"
      >
        <GithubLogoIcon className="size-4" aria-hidden />
        {s.repoUrl.replace("https://github.com/", "")}
        {s.ref && ` · ${s.ref}`}
        {s.commitSha && (
          <span className="font-mono text-xs text-body">
            @{s.commitSha.slice(0, 7)}
          </span>
        )}
      </a>
      <span className="text-caption">
        Handed in {formatDateTime(String(s.submittedAt))}
        {s.late && " · late"}
        {!s.commitSha &&
          " · couldn't pin a commit (GitHub didn't answer); your teacher sees the branch as it is"}
      </span>
    </>
  )
}
