"use client"

import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"

/** The HTTP status an error carries (an ApiRequestError's), if any. */
function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === "number" ? status : null
}

/**
 * What a page shows when it can't be shown: no access, not found, or a failure, in plain
 * words with a way on. Used by every error.tsx and not-found.tsx, so a refused or missing
 * page never sits on a loading skeleton.
 */
export function ErrorView({
  error,
  reset,
  notFound = false,
}: {
  error?: unknown
  reset?: () => void
  notFound?: boolean
}) {
  const status = notFound ? 404 : statusOf(error)
  const message =
    error instanceof Error && status !== null ? error.message : null
  const [title, fallback] =
    status === 403
      ? ["You don't have access to this", "Your role here doesn't open this page. Ask an administrator if you need it."]
      : status === 404
        ? ["Not found", "This page doesn't exist, or it's switched off here."]
        : ["Something went wrong", "This page couldn't load. Try again in a moment."]
  return (
    <Empty
      className="mx-auto my-10 max-w-xl border border-dashed border-hairline"
      data-testid="error-view"
      data-status={status ?? "error"}
    >
      <EmptyHeader>
        <EmptyTitle role="heading" aria-level={1}>
          {title}
        </EmptyTitle>
        <EmptyDescription>{message || fallback}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center gap-2">
        {status === null && reset && (
          <button type="button" onClick={reset} className={buttonVariants()}>
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => history.back()}
          className={buttonVariants({ variant: "outline" })}
        >
          Go back
        </button>
        <Link href="/home" className={buttonVariants({ variant: "ghost" })}>
          Home
        </Link>
      </EmptyContent>
    </Empty>
  )
}
