"use client"

import { CopyIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/** Dots standing in for a hidden value, about as long as it (so the layout doesn't jump). */
export const masked = (value: string) =>
  "•".repeat(Math.min(Math.max(value.length, 8), 32))

/** The eye button: shows or hides a secret, saying which for screen readers. */
export function RevealButton({
  shown,
  onToggle,
  what = "secret",
}: {
  shown: boolean
  onToggle: () => void
  what?: string
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={shown ? `Hide ${what}` : `Show ${what}`}
      aria-pressed={shown}
      title={shown ? "Hide" : "Show"}
      onClick={onToggle}
    >
      {shown ? <EyeSlashIcon aria-hidden /> : <EyeIcon aria-hidden />}
    </Button>
  )
}

/**
 * A secret on screen (a key, a token, a private link): dots by default, the eye to show it,
 * and Copy, which copies the real value without showing it. Someone looking over a shoulder or
 * at a shared screen sees nothing until it's asked for.
 */
export function SecretValue({
  value,
  label,
  what,
  testId,
  display,
  className,
}: {
  value: string
  /** Shown above it. */
  label?: ReactNode
  /** What it is, for the eye button's label ("API key"). */
  what?: string
  testId?: string
  /** How to show it once revealed (spaced into groups, for instance); the value by default. */
  display?: string
  className?: string
}) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && <span className="text-caption">{label}</span>}
      <div className="flex min-w-0 items-center gap-1.5">
        <code
          data-testid={testId}
          data-shown={shown || undefined}
          className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-ink"
        >
          {shown ? (display ?? value) : masked(value)}
        </code>
        <RevealButton
          shown={shown}
          onToggle={() => setShown(!shown)}
          what={what}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(value)
              .then(() => setCopied(true))
          }
        >
          <CopyIcon aria-hidden /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  )
}
