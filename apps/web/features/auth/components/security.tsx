"use client"

import {
  BrowsersIcon,
  DeviceMobileIcon,
  EnvelopeSimpleIcon,
  FingerprintIcon,
  DevicesIcon,
  KeyIcon,
  LockKeyIcon,
  PlusIcon,
} from "@phosphor-icons/react"
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

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextInput } from "@/components/form"
import { PASSWORD, passwordProblem } from "@workspace/judge"

import { masked, RevealButton, SecretValue } from "@/components/secret-value"
import { Row, Section } from "@/components/settings-sections"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDate } from "@/lib/format"

import { addPasskey, passkeySecondStep } from "../passkey-client"
import type { listPasskeys } from "../passkeys"
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
  const methodCount =
    Number(s.methods.app) + Number(s.methods.email) + Number(s.methods.passkey)
  const twoStepRows = (
    <>
      <MethodRow
        icon={<DeviceMobileIcon aria-hidden />}
        title="Authenticator app"
        detail="Google Authenticator, Microsoft Authenticator, 1Password and others. Works offline."
        on={s.methods.app}
        onAdd={() => setSetting("app")}
        onRemove={() => setDialog({ kind: "remove", method: "app" })}
        testId="method-app"
      />
      <MethodRow
        icon={<EnvelopeSimpleIcon aria-hidden />}
        title="Codes by email"
        detail={
          s.emailAvailable || s.methods.email
            ? `A code is sent to ${s.email} each time you sign in.`
            : "This site can't send email yet, so codes by email aren't available."
        }
        on={s.methods.email}
        disabled={!s.emailAvailable && !s.methods.email}
        onAdd={() => setSetting("email")}
        onRemove={() => setDialog({ kind: "remove", method: "email" })}
        testId="method-email"
      />
      <Row
        icon={<FingerprintIcon aria-hidden />}
        title="Passkeys"
        status={s.methods.passkey ? "On" : "Off"}
        on={s.methods.passkey}
        detail="A passkey passes this step too. Add or remove them under How you sign in."
        testId="method-passkey"
      />
      {s.enabled && (
        <Row
          icon={<KeyIcon aria-hidden />}
          title="Backup codes"
          status={`${s.backupCodesLeft} left`}
          on={s.backupCodesLeft > 3}
          warn={s.backupCodesLeft <= 3}
          detail="One-time codes for when you can't use any other way. Keep them somewhere safe."
          testId="backup-left"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog({ kind: "codes" })}
            >
              Regenerate
            </Button>
          }
        >
          {fresh && <BackupCodes codes={fresh} />}
        </Row>
      )}
      {s.enabled && (
        <Row
          icon={<BrowsersIcon aria-hidden />}
          title="Trusted browsers"
          detail={
            note ?? "Browsers you trusted skip the second step for 30 days."
          }
          action={
            <Button
              size="sm"
              variant="ghost"
              disabled={forget.isPending}
              onClick={() => forget.mutate()}
            >
              Forget them
            </Button>
          }
        />
      )}
    </>
  )
  return (
    <div className="grid max-w-4xl gap-8">
      {s.required && !s.enabled && (
        <p
          role="alert"
          className="rounded-md border border-hairline bg-destructive/10 p-3 text-body-sm text-ink"
        >
          Your account needs two-step verification. Turn on a method below to
          carry on using the site.
        </p>
      )}
      <Section
        title="How you sign in"
        description="The ways you can get into your account."
      >
        <PasskeysRow onChange={refresh} />
        <PasswordCard />
      </Section>
      <Section
        title="Two-step verification"
        description="After your password, Google or your college, a second step proves it's you. Turn on more than one, so losing one doesn't lock you out."
        testId="two-factor"
        status={
          <span
            data-testid="two-factor-state"
            className={s.enabled ? "text-success" : "text-body"}
          >
            {s.enabled ? `On since ${formatDate(s.enabledAt!)}.` : "Off."}
          </span>
        }
        footer={
          s.enabled && s.required ? (
            <p className="text-caption">
              Required for your account, so its last method can&apos;t be
              removed.
            </p>
          ) : null
        }
      >
        {twoStepRows}
      </Section>
      <Section
        title="Where you're signed in"
        description="Left yourself signed in somewhere, or lost a device?"
      >
        <SessionsCard />
      </Section>
      {/* Setting a method up is one focused step: a dialog over the page. */}
      <Dialog
        open={setting !== null}
        onOpenChange={(open) => !open && setSetting(null)}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {setting === "email"
                ? "Turn on codes by email"
                : "Set up an authenticator app"}
            </DialogTitle>
            <DialogDescription>
              {setting === "email"
                ? `We'll send a code to ${s.email}; enter it to confirm.`
                : "Scan the code with your app, keep the backup codes somewhere safe, then enter the code the app shows."}
            </DialogDescription>
          </DialogHeader>
          {setting === "app" && (
            <AppSetup
              onDone={() => (setSetting(null), refresh())}
              onCancel={() => setSetting(null)}
            />
          )}
          {setting === "email" && (
            <EmailSetup
              address={s.email}
              onDone={() => (setSetting(null), refresh())}
              onCancel={() => setSetting(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {dialog && (
        <CodeDialog
          kind={dialog.kind}
          method={dialog.kind === "remove" ? dialog.method : undefined}
          last={dialog.kind === "remove" && methodCount === 1}
          emailOn={s.methods.email}
          passkeyOn={s.methods.passkey}
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
  icon,
  title,
  detail,
  on,
  disabled,
  onAdd,
  onRemove,
  testId,
}: {
  icon: ReactNode
  title: string
  detail: string
  on: boolean
  disabled?: boolean
  onAdd: () => void
  onRemove: () => void
  testId: string
}) {
  return (
    <Row
      icon={icon}
      title={title}
      status={on ? "On" : "Off"}
      on={on}
      detail={detail}
      testId={testId}
      action={
        on ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onAdd}
          >
            Turn on
          </Button>
        )
      }
    />
  )
}

/**
 * Passkeys (features/auth/passkeys.ts): sign in with Face ID, Touch ID, Windows Hello or a
 * security key, and pass the second step with one. The first one turns two-factor on and brings
 * backup codes; removing one asks for a recent second step.
 */
function PasskeysRow({ onChange }: { onChange: () => void }) {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: ["me", "security", "passkeys"],
    queryFn: () => api<ApiResult<typeof listPasskeys>>("/me/security/passkeys"),
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const supported =
    typeof window !== "undefined" && "PublicKeyCredential" in window
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["me", "security", "passkeys"] })
    onChange()
  }
  // Straight to the device's own prompt, as Google and Clerk do; named after where it was made.
  const add = async () => {
    setBusy(true)
    setMessage(null)
    const { problem, backupCodes } = await addPasskey(deviceName())
    setBusy(false)
    if (problem) {
      if (problem !== "cancelled")
        setMessage({ text: STEP_MESSAGES[problem], kind: "err" })
      return
    }
    if (backupCodes) setCodes(backupCodes)
    setMessage({ text: "Passkey added.", kind: "ok" })
    refresh()
  }
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/me/security/passkeys/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  const count = list.data?.length ?? 0
  return (
    <Row
      icon={<FingerprintIcon aria-hidden />}
      title="Passkeys"
      status={list.data ? (count ? `${count} added` : "None yet") : undefined}
      on={count > 0}
      detail="Sign in with your fingerprint, face or screen lock instead of a password; it counts as your second step too. It stays on your device or your password manager."
      testId="passkeys"
      action={
        supported ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void add()}
          >
            <PlusIcon aria-hidden />
            Add a passkey
          </Button>
        ) : undefined
      }
    >
      {!list.data ? (
        <Loading error={list.error} />
      ) : (
        <>
          {list.data.length > 0 && (
            <ul className="grid divide-y divide-hairline rounded-md border border-hairline">
              {list.data.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-body-sm"
                  data-testid="passkey-row"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-ink">{p.name}</span>
                    <span className="block text-caption text-body">
                      Added {formatDate(p.createdAt)} ·{" "}
                      {p.lastUsedAt
                        ? `last used ${formatDate(p.lastUsedAt)}`
                        : "not used yet"}
                      {p.backedUp ? " · synced" : ""}
                    </span>
                  </span>
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title={`Remove ${p.name}?`}
                    description="It won't sign you in any more. If it's your only way through the second step, two-step verification goes off."
                    confirmLabel="Remove passkey"
                    onConfirm={() => remove.mutate(p.id)}
                  >
                    Remove
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          )}
          {!supported && (
            <p className="text-caption">
              This browser can&apos;t make passkeys.
            </p>
          )}
          {message && <FormMessage message={message} />}
          {codes && <BackupCodes codes={codes} />}
        </>
      )}
    </Row>
  )
}

/** A name for a new passkey: the browser and system it was made on ("Chrome on macOS"). */
function deviceName() {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser"
  const system = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "this device"
  return `${browser} on ${system}`
}

/** New backup codes: hidden until asked for (shared screens), then copied or downloaded. */
function BackupCodes({ codes }: { codes: string[] }) {
  const [shown, setShown] = useState(false)
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
      <div className="flex items-start gap-2">
        <ul
          className="grid flex-1 grid-cols-2 gap-1 font-mono text-body-sm text-ink sm:grid-cols-5"
          data-shown={shown || undefined}
        >
          {codes.map((c) => (
            <li key={c}>{shown ? c : masked(c).slice(0, c.length)}</li>
          ))}
        </ul>
        <RevealButton
          shown={shown}
          onToggle={() => setShown(!shown)}
          what="backup codes"
        />
      </div>
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
          <p className="text-body">Can&apos;t scan? Add an account by key:</p>
          <SecretValue
            value={setup.secret}
            display={setup.secret.match(/.{1,4}/g)!.join(" ")}
            what="setup key"
            testId="app-secret"
          />
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
  passkeyOn,
  onDone,
}: {
  kind: "remove" | "codes"
  method?: Method
  last: boolean
  emailOn: boolean
  /** A passkey can confirm it instead of a code (someone with only a passkey has no code). */
  passkeyOn: boolean
  onDone: (codes?: string[]) => void
}) {
  const [code, setCode] = useState("")
  const [passkeyProblem, setPasskeyProblem] = useState<string | null>(null)
  const mail = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof emailConfirmCode>>("/me/security/code", {
        method: "POST",
      }),
  })
  // Without a code, the server takes the passkey just confirmed (a second step this minute).
  const act = useMutation({
    mutationFn: (withCode: string | undefined) =>
      kind === "remove"
        ? api("/me/security/remove", { body: { method, code: withCode } }).then(
            () => undefined
          )
        : api<ApiResult<typeof renewBackupCodes>>("/me/security/backup-codes", {
            body: { code: withCode },
          }).then((r) => r.backupCodes),
    onSuccess: (codes) => onDone(codes),
  })
  const withPasskey = async () => {
    setPasskeyProblem(null)
    const problem = await passkeySecondStep("stepUp")
    if (problem) return setPasskeyProblem(problem)
    act.mutate(undefined)
  }
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
            {passkeyOn
              ? "Confirm with your passkey, or type a current code from the app, an emailed code or a backup code."
              : "Type a current code from the app, an emailed code or a backup code to confirm."}
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
        {passkeyOn && (
          <Button
            size="sm"
            className="justify-self-start"
            disabled={act.isPending}
            onClick={() => void withPasskey()}
          >
            <FingerprintIcon aria-hidden />
            Use a passkey instead
          </Button>
        )}
        {passkeyProblem && (
          <FormMessage message={{ text: passkeyProblem, kind: "err" }} />
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
            onClick={() => act.mutate(code)}
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
    <Row
      icon={<LockKeyIcon aria-hidden />}
      title="Password"
      status={has ? "Set" : "Not set"}
      on={has}
      detail={
        has
          ? "Sign in with your email and password."
          : "You sign in another way. Add a password to sign in with your email too."
      }
      testId="password-card"
      action={
        open ? undefined : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {has ? "Change" : "Add a password"}
          </Button>
        )
      }
    >
      {done && <FormMessage message={{ text: done, kind: "ok" }} />}
      {open && (
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
      )}
    </Row>
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
    <Row
      icon={<DevicesIcon aria-hidden />}
      title="Every device"
      detail="Sign out on every device and browser you've used, this one included."
      testId="sessions-card"
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={out.isPending}
          onClick={() => out.mutate()}
        >
          Sign out everywhere
        </Button>
      }
    />
  )
}
