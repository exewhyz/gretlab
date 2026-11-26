import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

/*
 * Account settings laid out as account pages are (Clerk's profile, Google's "How you sign in"):
 * sections with what they're about on the left on wide screens, and rows that each say what a
 * thing is, whether it's on, and what you can do. Used by Account › Profile and › Security.
 */

/**
 * A group of settings, as account pages lay them out (Clerk's, Google's): what it's about on
 * the left on wide screens, its rows on the right; stacked on a phone.
 */
export function Section({
  title,
  description,
  status,
  footer,
  testId,
  padded,
  children,
}: {
  title: string
  description: string
  status?: ReactNode
  footer?: ReactNode
  testId?: string
  /** Its content is a form, not rows: padded, without dividers. */
  padded?: boolean
  children: ReactNode
}) {
  return (
    <section
      className="grid gap-3 border-t border-hairline pt-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8"
      data-testid={testId}
    >
      <div className="grid content-start gap-1">
        <h3 className="text-title-sm text-ink">{title}</h3>
        <p className="text-body-sm text-body">{description}</p>
        {status && <div className="text-body-sm">{status}</div>}
      </div>
      <div className="grid content-start gap-2">
        <div
          className={cn(
            "grid rounded-lg bg-card ring-1 ring-foreground/10",
            padded ? "gap-4 p-4" : "divide-y divide-hairline"
          )}
        >
          {children}
        </div>
        {footer}
      </div>
    </section>
  )
}

/** One way in or one setting: what it is, whether it's on, and what you can do. */
export function Row({
  icon,
  title,
  status,
  on,
  warn,
  detail,
  action,
  testId,
  children,
}: {
  icon: ReactNode
  title: string
  status?: string
  on?: boolean
  warn?: boolean
  detail: ReactNode
  action?: ReactNode
  testId?: string
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3 p-4" data-testid={testId}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 text-lg text-body" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-ink">
            {title}
            {status && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-caption font-normal",
                  warn
                    ? "bg-destructive/10 text-destructive"
                    : on
                      ? "bg-success/10 text-success"
                      : "bg-muted text-body"
                )}
              >
                {status}
              </span>
            )}
          </div>
          <div className="text-xs text-body">{detail}</div>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}
