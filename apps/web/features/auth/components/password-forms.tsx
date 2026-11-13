"use client"

import { EyeIcon, EyeSlashIcon, GoogleLogoIcon } from "@phosphor-icons/react"
import { passwordProblem, PASSWORD } from "@workspace/judge"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { useState, type FormEvent } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { FormMessage } from "@/components/form"
import { api } from "@/lib/api/client"

/*
 * Signing in, signing up, confirming an address and resetting a password. Google and
 * email-with-password sit side by side; both continue through /sign-in/continue, which asks
 * for the second step when it's owed.
 */

const continueTo = (next: string) => `/sign-in/continue?next=${encodeURIComponent(next)}`

type Message = { text: string; kind: "ok" | "err" } | null

export function GoogleButton({ next, label = "Continue with Google" }: { next: string; label?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => signIn("google", { callbackUrl: continueTo(next) })}
    >
      <GoogleLogoIcon weight="bold" aria-hidden />
      {label}
    </Button>
  )
}

export function Divider() {
  return (
    <div className="flex items-center gap-3 text-caption text-muted-foreground" aria-hidden>
      <span className="h-px flex-1 bg-hairline" />
      or
      <span className="h-px flex-1 bg-hairline" />
    </div>
  )
}

function TextField({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof Input>) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-caption font-semibold text-ink">
        {label}
      </Label>
      <Input id={id} className="h-10 bg-card" {...props} />
    </div>
  )
}

function PasswordField({
  label = "Password",
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  autoComplete: "current-password" | "new-password"
  hint?: string | null
}) {
  const [shown, setShown] = useState(false)
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-caption font-semibold text-ink">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          maxLength={PASSWORD.max}
          className="h-10 bg-card pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeSlashIcon /> : <EyeIcon />}
        </Button>
      </div>
      {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
    </div>
  )
}

const REASONS: Record<string, string> = {
  wrong: "That email and password don't match. Check them, or reset your password.",
  locked: "Too many wrong passwords: password sign-in is paused for 15 minutes. You can still continue with Google, or reset your password.",
  unverified: "Confirm your email first: we sent you a link when you signed up.",
}

export function SignInForm({ callbackUrl: next, devLogin }: { callbackUrl: string; devLogin: boolean }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [devEmail, setDevEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [unverified, setUnverified] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const result = await signIn("password", { email, password, redirect: false, callbackUrl: continueTo(next) })
    if (result?.ok && !result.error) {
      window.location.href = continueTo(next)
      return
    }
    setBusy(false)
    const reason = result?.error ?? "wrong"
    setUnverified(reason === "unverified")
    setMessage({ text: REASONS[reason] ?? REASONS.wrong!, kind: "err" })
  }
  const resend = async () => {
    await api("/auth/resend", { body: { email } }).catch(() => null)
    setMessage({ text: "If that account still needs confirming, a new link is on its way.", kind: "ok" })
    setUnverified(false)
  }
  return (
    <div className="grid gap-4">
      <GoogleButton next={next} />
      <Divider />
      <form className="grid gap-3" onSubmit={submit} data-testid="password-sign-in">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-caption text-primary hover:underline">
            Forgot your password?
          </Link>
        </div>
        <FormMessage message={message} />
        {unverified && (
          <Button type="button" variant="outline" onClick={resend}>
            Send the link again
          </Button>
        )}
        <Button type="submit" disabled={busy || !email || !password}>
          Sign in
        </Button>
      </form>
      <p className="text-center text-body-sm">
        New here?{" "}
        <Link href={`/sign-up${next !== "/" ? `?callbackUrl=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
      {devLogin && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-hairline-strong p-3">
          <Input
            aria-label="Development login email"
            placeholder="anyone@example.com"
            value={devEmail}
            onChange={(event) => setDevEmail(event.target.value)}
            className="h-8 min-w-0 flex-1 bg-card"
          />
          <Button variant="outline" size="sm" onClick={() => signIn("dev", { email: devEmail, callbackUrl: continueTo(next) })}>
            Dev login
          </Button>
        </div>
      )}
    </div>
  )
}

export function SignUpForm({ next }: { next: string }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [sent, setSent] = useState(false)
  const problem = password ? passwordProblem(password, email) : null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await api("/auth/sign-up", { body: { name, email, password } })
      setSent(true)
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: "err" })
    } finally {
      setBusy(false)
    }
  }
  if (sent)
    return (
      <div className="grid gap-3 rounded-xl border border-hairline bg-card p-5" data-testid="sign-up-sent" role="status">
        <h2 className="text-title-md font-semibold text-ink">Check your email</h2>
        <p>
          We&apos;ve sent a link to <strong className="text-ink">{email}</strong>. Open it to confirm your
          address, then sign in. It works for 24 hours.
        </p>
        <p className="text-caption">
          Nothing there? Look in spam, or{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => api("/auth/resend", { body: { email } }).then(() => setMessage({ text: "Sent again.", kind: "ok" }))}
          >
            send it again
          </button>
          .
        </p>
        <FormMessage message={message} />
      </div>
    )
  return (
    <div className="grid gap-4">
      <GoogleButton next={next} label="Sign up with Google" />
      <Divider />
      <form className="grid gap-3" onSubmit={submit} data-testid="sign-up-form">
        <TextField label="Name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={problem ?? `At least ${PASSWORD.min} characters. A few words you'll remember work well.`}
        />
        <FormMessage message={message} />
        <Button type="submit" disabled={busy || !name.trim() || !email || Boolean(problem) || !password}>
          Create account
        </Button>
      </form>
      <p className="text-center text-body-sm">
        Already have an account?{" "}
        <Link href={`/sign-in${next !== "/" ? `?callbackUrl=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}

export function ConfirmEmail({ token, valid }: { token: string; valid: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "bad">(valid ? "idle" : "bad")
  const confirm = async () => {
    setState("busy")
    try {
      await api("/auth/verify", { body: { token } })
      setState("done")
    } catch {
      setState("bad")
    }
  }
  if (state === "done")
    return (
      <div className="grid gap-3" role="status" data-testid="email-confirmed">
        <p>Your email is confirmed. You can sign in now.</p>
        <Link href="/sign-in" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    )
  if (state === "bad")
    return (
      <div className="grid gap-3" role="alert">
        <p>This link has expired or was already used.</p>
        <p className="text-caption">
          Sign in to have a new one sent, or <Link href="/sign-up" className="text-primary underline">sign up again</Link>.
        </p>
      </div>
    )
  return (
    <div className="grid gap-3">
      <p>Confirm this is your email address to finish making your account.</p>
      <Button onClick={confirm} disabled={state === "busy"}>
        Confirm my email
      </Button>
    </div>
  )
}

export function ForgotForm() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  if (sent)
    return (
      <p role="status" data-testid="forgot-sent">
        If there&apos;s an account for <strong className="text-ink">{email}</strong>, we&apos;ve emailed it a link
        to choose a new password. It works for an hour.
      </p>
    )
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        await api("/auth/forgot", { body: { email } }).catch(() => null)
        setSent(true)
      }}
    >
      <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button type="submit" disabled={busy || !email}>
        Email me a link
      </Button>
    </form>
  )
}

export function ResetForm({ token, valid }: { token: string; valid: boolean }) {
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [state, setState] = useState<"idle" | "busy" | "done">("idle")
  const [message, setMessage] = useState<Message>(null)
  const problem = password ? passwordProblem(password) : null
  if (!valid)
    return (
      <div className="grid gap-2" role="alert">
        <p>This link has expired or was already used.</p>
        <Link href="/forgot-password" className="text-primary underline">
          Ask for a new one
        </Link>
      </div>
    )
  if (state === "done")
    return (
      <div className="grid gap-3" role="status" data-testid="password-reset">
        <p>Your password is changed, and you&apos;ve been signed out everywhere else. Sign in with it now.</p>
        <Link href="/sign-in" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    )
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (password !== again) return setMessage({ text: "The two passwords don't match.", kind: "err" })
        setState("busy")
        try {
          await api("/auth/reset", { body: { token, password } })
          setState("done")
        } catch (error) {
          setState("idle")
          setMessage({ text: (error as Error).message, kind: "err" })
        }
      }}
    >
      <PasswordField
        label="New password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={problem ?? `At least ${PASSWORD.min} characters.`}
      />
      <PasswordField label="Type it again" value={again} onChange={setAgain} autoComplete="new-password" />
      <FormMessage message={message} />
      <Button type="submit" disabled={state === "busy" || !password || Boolean(problem)}>
        Set new password
      </Button>
    </form>
  )
}
