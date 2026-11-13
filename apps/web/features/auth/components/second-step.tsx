"use client"

import { signOut } from "next-auth/react"
import { useEffect, useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { Field, FormMessage, TextInput } from "@/components/form"
import { api } from "@/lib/api/client"

import { sendSecondStep, STEP_MESSAGES } from "../session-step"

type Mode = "app" | "email" | "backup"

/**
 * The second sign-in step: a code from the authenticator app, a code by email, or a
 * backup code; optionally trusting this browser for 30 days.
 */
export function SecondStep({
  email,
  next,
  options,
}: {
  email: string
  next: string
  options: { app: boolean; email: boolean; address: string }
}) {
  const [mode, setMode] = useState<Mode>(
    options.app ? "app" : options.email ? "email" : "backup"
  )
  const [code, setCode] = useState("")
  const [trust, setTrust] = useState(false)
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [wait, setWait] = useState(0)
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const emailMe = async () => {
    setMessage(null)
    try {
      const r = await api<{ sentTo: string; resendIn: number }>(
        "/auth/two-factor/email",
        { method: "POST" }
      )
      setSent(true)
      setWait(r.resendIn)
      setMessage({
        text: `Sent to ${r.sentTo}. It works for 10 minutes.`,
        kind: "ok",
      })
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: "err" })
    }
  }

  const submit = async () => {
    setBusy(true)
    setMessage(null)
    const problem = await sendSecondStep({ secondStep: code })
    if (problem) {
      setMessage({ text: STEP_MESSAGES[problem], kind: "err" })
      setBusy(false)
      return
    }
    if (trust)
      await api("/me/security/trust", { method: "POST" }).catch(() => {})
    // A full load, so nothing remembered from before the step (who's signed in) is reused.
    window.location.assign(next)
  }

  const choose = (m: Mode) => {
    setMode(m)
    setCode("")
    setMessage(null)
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p>
        Signed in as <span className="text-ink">{email}</span>.{" "}
        {mode === "app" &&
          "Open your authenticator app and type the 6-digit code for this site."}
        {mode === "email" &&
          `We'll email a 6-digit code to ${options.address}.`}
        {mode === "backup" &&
          "Type one of the backup codes you saved. Each works once."}
      </p>
      {mode === "email" && (
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={wait > 0}
          onClick={() => void emailMe()}
        >
          {sent
            ? wait > 0
              ? `Send another in ${wait}s`
              : "Send another code"
            : "Email me a code"}
        </Button>
      )}
      {(mode !== "email" || sent) && (
        <Field label={mode === "backup" ? "Backup code" : "Code"}>
          <TextInput
            autoFocus
            autoComplete="one-time-code"
            inputMode={mode === "backup" ? "text" : "numeric"}
            placeholder={mode === "backup" ? "abcd-efgh" : "123456"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="max-w-48 font-mono tracking-widest"
          />
        </Field>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => setTrust(e.target.checked)}
        />
        Don&apos;t ask again on this browser for 30 days
      </label>
      {message && <FormMessage message={message} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || code.trim().length < 6}>
          Continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void signOut({ callbackUrl: "/" })}
        >
          Sign out
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-caption">
        {options.app && mode !== "app" && (
          <button
            type="button"
            className="underline"
            onClick={() => choose("app")}
          >
            Use the app
          </button>
        )}
        {options.email && mode !== "email" && (
          <button
            type="button"
            className="underline"
            onClick={() => choose("email")}
          >
            Email me a code instead
          </button>
        )}
        {mode !== "backup" && (
          <button
            type="button"
            className="underline"
            onClick={() => choose("backup")}
          >
            Use a backup code
          </button>
        )}
      </div>
    </form>
  )
}
