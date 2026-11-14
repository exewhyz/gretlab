"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState, type ReactNode } from "react"

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
import { PASSWORD, passwordProblem } from "@workspace/judge"

import { Card, Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDate } from "@/lib/format"

import { sendSecondStep, STEP_MESSAGES } from "../session-step"
import type { ApiResult } from "@/lib/api/types"
import type { startAppSetup, twoFactorStatus } from "@/features/auth/two-factor"
import type { passwordStatus } from "@/features/auth/password"
import type {
  emailConfirmCode,
  renewBackupCodes,
  startEmailSetup,
} from "@/features/auth/two-factor"

type Status = ApiResult<typeof twoFactorStatus>

type Method = "app" | "email"

/** Account › Security: two-factor sign-in by app, email or both; backup codes; trusted browsers. */
export function SecuritySettings() {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: ["me", "security"],
    queryFn: () => api<Status>("/me/security"),
  })
  const [setting, setSetting] = useState<Method | null>(null)
  const [dialog, setDialog] = useState<
    { kind: "remove"; method: Method } | { kind: "codes" } | null
  >(null)
  const [fresh, setFresh] = useState<string[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // ["me"] is the viewer (header, banner); it also covers ["me", "security"].
  const refresh = () => void client.invalidateQueries({ queryKey: ["me"] })
  const forget = useMutation({
    mutationFn: () => api("/me/security/forget-browsers", { method: "POST" }),
    onSuccess: () =>
      setNote(
        "Every browser will ask for the second step again, this one included next time."
      ),
  })
  if (!status.data) return <Loading error={status.error} />
  const s = status.data
  const methodCount = Number(s.methods.app) + Number(s.methods.email)
  return (
    <div className="grid max-w-2xl gap-4">
      <h1 className="text-display-sm text-ink">Security</h1>
      {s.required && !s.enabled && (
        <p
          role="alert"
          className="rounded-md border border-hairline bg-destructive/10 p-3 text-body-sm text-ink"
        >
          Your account needs two-factor sign-in. Turn on a method below to carry
          on using the site.
        </p>
      )}
      <Card data-testid="two-factor">
        <h2 className="mb-1 text-title-sm text-ink">Two-factor sign-in</h2>
        <p className="mb-3 text-body-sm text-body">
          After your password or Google, you also prove it&apos;s you with a
          code: from an authenticator app on your phone, or sent to your email.
          Turn on both, so losing one doesn&apos;t lock you out.
        </p>
        <p
          className="mb-3 text-body-sm text-ink"
          data-testid="two-factor-state"
        >
          {s.enabled ? `On since ${formatDate(s.enabledAt!)}.` : "Off."}
        </p>
        <div className="grid divide-y divide-hairline rounded-md border border-hairline">
          <MethodRow
            title="Authenticator app"
            detail="Google Authenticator, Microsoft Authenticator, 1Password and others. Works offline."
            on={s.methods.app}
            onAdd={() => setSetting("app")}
            onRemove={() => setDialog({ kind: "remove", method: "app" })}
            testId="method-app"
          >
            {setting === "app" && (
              <AppSetup
                onDone={() => (setSetting(null), refresh())}
                onCancel={() => setSetting(null)}
              />
            )}
          </MethodRow>
          {(s.emailAvailable || s.methods.email) && (
            <MethodRow
              title="Codes by email"
              detail={`A code is sent to ${s.email} each time you sign in.`}
              on={s.methods.email}
              onAdd={() => setSetting("email")}
              onRemove={() => setDialog({ kind: "remove", method: "email" })}
              testId="method-email"
            >
              {setting === "email" && (
                <EmailSetup
                  address={s.email}
                  onDone={() => (setSetting(null), refresh())}
                  onCancel={() => setSetting(null)}
                />
              )}
            </MethodRow>
          )}
        </div>
        {s.enabled && (
          <div className="mt-4 grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
              <span className="text-ink" data-testid="backup-left">
                {s.backupCodesLeft} backup code
                {s.backupCodesLeft === 1 ? "" : "s"} left
                {s.backupCodesLeft <= 3 && (
                  <span className="text-destructive">: make new ones soon</span>
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog({ kind: "codes" })}
              >
                New backup codes
              </Button>
            </div>
            {fresh && <BackupCodes codes={fresh} />}
            <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
              <span className="text-body">
                Browsers you trusted skip the code for 30 days.
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={forget.isPending}
                onClick={() => forget.mutate()}
              >
                Forget trusted browsers
              </Button>
            </div>
            {note && <p className="text-caption text-success">{note}</p>}
            {s.required && (
              <p className="text-caption">
                Required for your account, so its last method can&apos;t be
                removed.
              </p>
            )}
          </div>
        )}
      </Card>
      <PasswordCard />
      <SessionsCard />
      {dialog && (
        <CodeDialog
          kind={dialog.kind}
          method={dialog.kind === "remove" ? dialog.method : undefined}
          last={dialog.kind === "remove" && methodCount === 1}
          emailOn={s.methods.email}
          onDone={(codes) => {
            setDialog(null)
            if (codes) setFresh(codes)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function MethodRow({
  title,
  detail,
  on,
  onAdd,
  onRemove,
  testId,
  children,
}: {
  title: string
  detail: string
  on: boolean
  onAdd: () => void
  onRemove: () => void
  testId: string
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3 p-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-body-sm font-medium text-ink">
            {title}{" "}
            <span className={on ? "text-success" : "text-body"}>
              · {on ? "On" : "Off"}
            </span>
          </div>
          <div className="text-xs text-body">{detail}</div>
        </div>
        {on ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        ) : (
          !children && (
            <Button size="sm" variant="outline" onClick={onAdd}>
              Turn on
            </Button>
          )
        )}
      </div>
      {children}
    </div>
  )
}

function BackupCodes({ codes }: { codes: string[] }) {
  const text = `Backup codes for ${location.host}. Each works once.\n\n${codes.join("\n")}\n`
  return (
    <div
      className="grid gap-2 rounded-md border border-hairline p-3"
      data-testid="backup-codes"
    >
      <p className="text-body-sm text-ink">
        Save these backup codes somewhere safe. If you can&apos;t get a code any
        other way, each one signs you in once. They won&apos;t be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-body-sm text-ink sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void navigator.clipboard?.writeText(text)}
        >
          Copy
        </Button>
        <a
          className="inline-flex items-center rounded-md border border-hairline px-3 text-body-sm"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="backup-codes.txt"
        >
          Download
        </a>
      </div>
    </div>
  )
}

/** The last part of turning a method on: saved backup codes (first method only) and a code. */
function Confirm({
  backupCodes,
  label,
  onConfirm,
  onCancel,
  extra,
}: {
  backupCodes: string[] | null
  label: string
  onConfirm: (code: string) => Promise<string | null>
  onCancel: () => void
  extra?: ReactNode
}) {
  const [saved, setSaved] = useState(!backupCodes)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="grid gap-3">
      {backupCodes && (
        <>
          <BackupCodes codes={backupCodes} />
          <label className="flex items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            I&apos;ve saved my backup codes
          </label>
        </>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(await onConfirm(code))
          setBusy(false)
        }}
      >
        <Field label={label}>
          <TextInput
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-40 font-mono tracking-widest"
          />
        </Field>
        <Button
          type="submit"
          disabled={!saved || busy || code.trim().length !== 6}
        >
          Turn on
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {extra}
      </form>
      {error && <FormMessage message={{ text: error, kind: "err" }} />}
    </div>
  )
}

type AppSetupData = ApiResult<typeof startAppSetup>

function AppSetup({
  onDone,
  onCancel,
}: {
  onDone: () => void
  onCancel: () => void
}) {
  const start = useQuery({
    queryKey: ["me", "security", "app-setup"],
    queryFn: () => api<AppSetupData>("/me/security/app", { method: "POST" }),
    staleTime: Infinity,
    gcTime: 0,
  })
  if (!start.data) return <Loading error={start.error} />
  const setup = start.data
  return (
    <div className="grid gap-4" data-testid="app-setup">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div
          className="size-40 rounded-md bg-white p-1"
          aria-label="QR code for your authenticator app"
          role="img"
          // Generated on the server by the qrcode library from our own otpauth link.
          dangerouslySetInnerHTML={{ __html: setup.qr }}
        />
        <div className="grid content-start gap-1 text-body-sm">
          <p className="text-ink">Scan this with your authenticator app.</p>
          <p className="text-body">
            Can&apos;t scan? Add an account by key:{" "}
            <code
              className="font-mono break-all text-ink"
              data-testid="app-secret"
            >
              {setup.secret.match(/.{1,4}/g)!.join(" ")}
            </code>
          </p>
          <a
            href={setup.url}
            className="text-caption text-body underline sm:hidden"
          >
            Open in an authenticator app on this phone
          </a>
        </div>
      </div>
      <Confirm
        backupCodes={setup.backupCodes}
        label="Code from the app"
        onCancel={onCancel}
        onConfirm={async (code) => {
          const problem = await sendSecondStep({ confirmApp: code })
          if (problem) return STEP_MESSAGES[problem]
          onDone()
          return null
        }}
      />
    </div>
  )
}

function EmailSetup({
  address,
  onDone,
  onCancel,
}: {
  address: string
  onDone: () => void
  onCancel: () => void
}) {
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [wait, setWait] = useState(0)
  const send = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof startEmailSetup>>("/me/security/email", {
        method: "POST",
      }),
    onSuccess: (r) => {
      if (r.backupCodes) setBackupCodes(r.backupCodes)
      setWait(r.resendIn)
    },
  })
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])
  return (
    <div className="grid gap-3" data-testid="email-setup">
      {!send.data ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={send.isPending}
            onClick={() => send.mutate()}
          >
            Email a code to {address}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <p className="text-body-sm text-ink">
            We sent a code to {send.data.sentTo}. It works for 10 minutes.
          </p>
          <Confirm
            backupCodes={backupCodes}
            label="Code from the email"
            onCancel={onCancel}
            onConfirm={async (code) => {
              const problem = await sendSecondStep({ confirmEmail: code })
              if (problem) return STEP_MESSAGES[problem]
              onDone()
              return null
            }}
            extra={
              <Button
                type="button"
                variant="ghost"
                disabled={wait > 0 || send.isPending}
                onClick={() => send.mutate()}
              >
                {wait > 0 ? `Send again in ${wait}s` : "Send again"}
              </Button>
            }
          />
        </>
      )}
      {send.error && (
        <FormMessage message={{ text: send.error.message, kind: "err" }} />
      )}
    </div>
  )
}

function CodeDialog({
  kind,
  method,
  last,
  emailOn,
  onDone,
}: {
  kind: "remove" | "codes"
  method?: Method
  last: boolean
  emailOn: boolean
  onDone: (codes?: string[]) => void
}) {
  const [code, setCode] = useState("")
  const mail = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof emailConfirmCode>>("/me/security/code", {
        method: "POST",
      }),
  })
  const act = useMutation({
    mutationFn: () =>
      kind === "remove"
        ? api("/me/security/remove", { body: { method, code } }).then(
            () => undefined
          )
        : api<ApiResult<typeof renewBackupCodes>>("/me/security/backup-codes", {
            body: { code },
          }).then((r) => r.backupCodes),
    onSuccess: (codes) => onDone(codes),
  })
  const name = method === "app" ? "the authenticator app" : "codes by email"
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === "codes"
              ? "New backup codes"
              : last
                ? "Turn off two-factor sign-in?"
                : `Remove ${name}?`}
          </DialogTitle>
          <DialogDescription>
            {kind === "codes"
              ? "Your old backup codes stop working."
              : last
                ? `It's your only method, so signing in will need only Google again.`
                : `You'll still sign in with your other method.`}{" "}
            Type a current code from the app, an emailed code or a backup code
            to confirm.
          </DialogDescription>
        </DialogHeader>
        <Field label="Code">
          <TextInput
            autoFocus
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        {emailOn && (
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={mail.isPending}
            onClick={() => mail.mutate()}
          >
            {mail.data
              ? `Sent to ${mail.data.sentTo}. Send another`
              : "Email me a code"}
          </Button>
        )}
        {(act.error ?? mail.error) && (
          <FormMessage
            message={{ text: (act.error ?? mail.error)!.message, kind: "err" }}
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button
            variant={kind === "remove" ? "destructive" : "default"}
            disabled={code.trim().length < 6 || act.isPending}
            onClick={() => act.mutate()}
          >
            {kind === "codes" ? "Make new codes" : last ? "Turn off" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Adding a password (to sign in without Google) or changing it, with the current one. */
function PasswordCard() {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: ["me", "password"],
    queryFn: () => api<ApiResult<typeof passwordStatus>>("/me/password"),
  })
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [password, setPassword] = useState("")
  const [done, setDone] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api("/me/password", {
        method: "PUT",
        body: { current: current || undefined, password },
      }),
    onSuccess: () => {
      setDone(
        status.data?.hasPassword
          ? "Password changed."
          : "Password added: you can sign in with it now."
      )
      setOpen(false)
      setCurrent("")
      setPassword("")
      void client.invalidateQueries({ queryKey: ["me", "password"] })
    },
  })
  if (!status.data) return null
  const has = status.data.hasPassword
  const problem = password ? passwordProblem(password) : null
  return (
    <Card data-testid="password-card">
      <h2 className="mb-1 text-title-sm text-ink">Password</h2>
      <p className="mb-3 text-body-sm text-body">
        {has
          ? "You can sign in with your email and password, as well as Google."
          : "You sign in with Google. Add a password to sign in with your email too."}
      </p>
      {done && <FormMessage message={{ text: done, kind: "ok" }} />}
      {open ? (
        <form
          className="grid max-w-sm gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          {has && (
            <Field label="Current password">
              <TextInput
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
          )}
          <Field
            label="New password"
            help={problem ?? `At least ${PASSWORD.min} characters.`}
          >
            <TextInput
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                save.isPending ||
                !password ||
                Boolean(problem) ||
                (has && !current)
              }
            >
              Save password
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          {has ? "Change password" : "Add a password"}
        </Button>
      )}
    </Card>
  )
}

/** Signing out on every device: a lost phone, a shared computer. */
function SessionsCard() {
  const out = useMutation({
    mutationFn: () => api("/me/sessions", { method: "DELETE" }),
    onSuccess: () => {
      window.location.href = "/sign-in"
    },
  })
  return (
    <Card data-testid="sessions-card">
      <h2 className="mb-1 text-title-sm text-ink">Signed-in devices</h2>
      <p className="mb-3 text-body-sm text-body">
        Left yourself signed in somewhere, or lost a device? Sign out
        everywhere, this browser included.
      </p>
      <Button
        variant="outline"
        disabled={out.isPending}
        onClick={() => out.mutate()}
      >
        Sign out everywhere
      </Button>
    </Card>
  )
}
