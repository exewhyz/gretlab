"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { Field, FormMessage, TextInput } from "@/components/form"
import { passkeySecondStep } from "@/features/auth/passkey-client"
import { sendSecondStep, STEP_MESSAGES } from "@/features/auth/session-step"
import { api, ApiRequestError } from "@/lib/api/client"
import { setStepUpAsker } from "@/lib/api/step-up"

/**
 * Asks for a fresh second-factor code when a protected action needs one (step-up,
 * lib/api/step-up.ts). Mounted once in the root layout; api() opens it and repeats the action
 * once a code is accepted. Closing it leaves the action undone.
 */
export function StepUpDialog() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const settle = useRef<((ok: boolean) => void) | null>(null)

  useEffect(() => {
    setStepUpAsker(
      () =>
        new Promise<boolean>((resolve) => {
          settle.current = resolve
          setCode("")
          setMessage(null)
          setOpen(true)
        })
    )
    return () => setStepUpAsker(null)
  }, [])

  const finish = (ok: boolean) => {
    setOpen(false)
    settle.current?.(ok)
    settle.current = null
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const refused = await sendSecondStep({ stepUp: code.trim() })
    setBusy(false)
    if (refused) {
      setMessage({ text: STEP_MESSAGES[refused], kind: "err" })
      return
    }
    finish(true)
  }

  // A passkey confirms it too; the device's own prompt, then the server checks it.
  const withPasskey = async () => {
    setBusy(true)
    setMessage(null)
    const refused = await passkeySecondStep("stepUp")
    setBusy(false)
    if (refused) {
      setMessage({ text: refused, kind: "err" })
      return
    }
    finish(true)
  }

  const emailMe = async () => {
    setMessage(null)
    try {
      await api("/me/security/step-up-code", { body: {} })
      setMessage({
        text: "We've emailed you a code. It works for 10 minutes.",
        kind: "ok",
      })
    } catch (error) {
      setMessage({
        text:
          error instanceof ApiRequestError
            ? error.message
            : "Couldn't send a code. Try again.",
        kind: "err",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish(false)}>
      {/* Above any sheet or dialog that's open: the action it holds up is usually in one. */}
      <DialogContent className="z-100 sm:max-w-md" data-testid="step-up">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Confirm it&apos;s you</DialogTitle>
            <DialogDescription>
              This change needs a fresh code: from your authenticator app, an
              emailed code, one of your backup codes, or a passkey. Then it goes
              ahead.
            </DialogDescription>
          </DialogHeader>
          <Field label="Code">
            <TextInput
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Code"
            />
          </Field>
          <FormMessage message={message} />
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-1">
              <Button type="button" variant="ghost" onClick={emailMe}>
                Email me a code
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void withPasskey()}
              >
                Use a passkey
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => finish(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || code.trim().length < 6}>
                {busy ? "Checking…" : "Confirm"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
