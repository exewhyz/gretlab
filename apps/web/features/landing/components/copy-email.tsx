"use client"

import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

/** The contact address with a copy button that says when it worked. */
export function CopyEmail({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setState("copied")
    } catch {
      setState("failed")
    }
    window.setTimeout(() => setState("idle"), 1800)
  }
  return (
    <span className="inline-flex items-center gap-2">
      <a href={`mailto:${email}`} className="text-body-sm text-ink underline-offset-4 hover:underline">
        {email}
      </a>
      <Button variant="ghost" size="sm" onClick={copy} aria-live="polite">
        {state === "copied" ? <CheckIcon aria-hidden data-icon="inline-start" /> : <CopyIcon aria-hidden data-icon="inline-start" />}
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
      </Button>
    </span>
  )
}
