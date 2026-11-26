"use client"

import { RevealButton, SecretValue } from "@/components/secret-value"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextInput } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import type { domainClaims } from "@/features/sso/domains"
import type { ssoSettings } from "@/features/sso/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

type Settings = ApiResult<typeof ssoSettings>

/** Manage › Single sign-on: connect the college's identity provider (OpenID Connect). */
export function SsoSettings({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "sso"],
    queryFn: () => api<Settings>(`/orgs/${slug}/sso`),
  })
  if (!data) return <Loading error={error} />
  return <SsoForm slug={slug} initial={data} />
}

function SsoForm({ slug, initial }: { slug: string; initial: Settings }) {
  const client = useQueryClient()
  const [issuer, setIssuer] = useState(initial.issuer)
  const [clientId, setClientId] = useState(initial.clientId)
  const [secret, setSecret] = useState("")
  const [showSecret, setShowSecret] = useState(false)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [required, setRequired] = useState(initial.required)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/sso`, {
        method: "PUT",
        body: {
          issuer,
          clientId,
          clientSecret: secret || undefined,
          enabled,
          required,
        },
      }),
    onSuccess: () => {
      setSecret("")
      void client.invalidateQueries({ queryKey: ["org", slug, "sso"] })
    },
    meta: { quiet: true, success: "Single sign-on saved." },
  })
  const noDomains = initial.domains.length === 0
  return (
    <div className="grid max-w-3xl gap-4" data-testid="sso-settings">
      <PageTitle>Single sign-on</PageTitle>
      <p className="text-body-sm text-body">
        Let your students and staff sign in with their college account
        (Microsoft 365, Google Workspace, Okta or any OpenID Connect provider).
        Signing in this way makes them members here. Two-factor sign-in still
        applies.
      </p>
      <DomainsCard slug={slug} />
      <Card className="grid gap-3">
        <h2 className="text-title-sm text-ink">Your identity provider</h2>
        <Field
          label="Redirect address"
          help="Give this to your identity provider as the app's redirect (callback) address."
        >
          <TextInput
            readOnly
            value={initial.redirectUri}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
        <Field
          label="Issuer"
          help="Its OpenID Connect issuer, for example https://login.microsoftonline.com/<tenant>/v2.0"
        >
          <TextInput
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Field label="Client ID">
          <TextInput
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </Field>
        <Field
          label="Client secret"
          help={
            initial.hasSecret
              ? "Saved. Type a new one only to replace it."
              : "From your identity provider. It's stored encrypted and never shown again."
          }
        >
          <div className="flex items-center gap-1.5">
            <TextInput
              type={showSecret ? "text" : "password"}
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <RevealButton
              shown={showSecret}
              onToggle={() => setShowSecret(!showSecret)}
              what="client secret"
            />
          </div>
        </Field>
        <label className="flex items-start gap-2 text-body-sm text-ink">
          <Switch
            checked={enabled}
            disabled={noDomains}
            onCheckedChange={setEnabled}
            aria-label="Sign in with the college"
          />
          <span>
            On
            <span className="block text-xs text-body">
              People with your domains see “Sign in with your college”.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-body-sm text-ink">
          <Switch
            checked={required && enabled}
            disabled={!enabled}
            onCheckedChange={setRequired}
            aria-label="Require it"
          />
          <span>
            Require it
            <span className="block text-xs text-body">
              Addresses on your domains can only sign in through your college:
              no GretLab passwords, and Google only if your provider is Google.
            </span>
          </span>
        </label>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <div>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </Card>
    </div>
  )
}

type Claims = ApiResult<typeof domainClaims>

/**
 * The college's email domains: proved with a DNS TXT record (features/sso/domains.ts), as Google
 * Workspace and Microsoft 365 do. Verified ones may sign in through its single sign-on.
 */
function DomainsCard({ slug }: { slug: string }) {
  const client = useQueryClient()
  const claims = useQuery({
    queryKey: ["org", slug, "sso", "domains"],
    queryFn: () => api<Claims>(`/orgs/${slug}/sso/domains`),
  })
  const [domain, setDomain] = useState("")
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const done = (data: Claims, text?: string) => {
    client.setQueryData(["org", slug, "sso", "domains"], data)
    // The switch below depends on there being a verified domain.
    void client.invalidateQueries({
      queryKey: ["org", slug, "sso"],
      exact: true,
    })
    setMessage(text ? { text, kind: "ok" } : null)
  }
  const fail = (e: Error) => setMessage({ text: e.message, kind: "err" })
  const add = useMutation({
    mutationFn: () =>
      api<Claims>(`/orgs/${slug}/sso/domains`, { body: { domain } }),
    onSuccess: (data) => {
      setDomain("")
      done(
        data,
        "Now add the TXT record below at your DNS host, then press Verify."
      )
    },
    onError: fail,
    meta: { quiet: true },
  })
  const verify = useMutation({
    mutationFn: (d: string) =>
      api<Claims>(`/orgs/${slug}/sso/domains/verify`, { body: { domain: d } }),
    onSuccess: (data, d) => done(data, `${d} is verified.`),
    onError: fail,
    meta: { quiet: true },
  })
  const remove = useMutation({
    mutationFn: (d: string) =>
      api<Claims>(`/orgs/${slug}/sso/domains`, {
        method: "DELETE",
        body: { domain: d },
      }),
    onSuccess: (data) => done(data),
    onError: fail,
    meta: { quiet: true },
  })
  return (
    <Card className="grid gap-3" data-testid="sso-domains-card">
      <div>
        <h2 className="text-title-sm text-ink">Your email domains</h2>
        <p className="text-body-sm text-body">
          Single sign-on only signs in addresses on domains your college has
          proved it owns, so no one can sign in someone else&apos;s address. Add
          a domain, put the TXT record we show at your DNS host (where your
          domain&apos;s records are managed), then press Verify.
        </p>
      </div>
      {!claims.data ? (
        <Loading error={claims.error} />
      ) : claims.data.verified.length + claims.data.pending.length > 0 ? (
        <ul className="grid divide-y divide-hairline rounded-md border border-hairline">
          {claims.data.verified.map((d) => (
            <li
              key={d}
              className="flex flex-wrap items-center gap-2 px-3 py-2 text-body-sm"
              data-testid="sso-domains"
            >
              <span className="flex-1 text-ink">{d}</span>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-caption text-success">
                Verified
              </span>
              <ConfirmButton
                size="sm"
                variant="ghost"
                title={`Remove ${d}?`}
                description="People with these addresses won't sign in through your college any more. Without any domain, single sign-on switches off."
                confirmLabel="Remove domain"
                onConfirm={() => remove.mutate(d)}
              >
                Remove
              </ConfirmButton>
            </li>
          ))}
          {claims.data.pending.map((c) => (
            <li
              key={c.domain}
              className="grid gap-2 px-3 py-3 text-body-sm"
              data-testid="sso-domain-pending"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 text-ink">{c.domain}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-body">
                  Waiting for DNS
                </span>
                <Button
                  size="sm"
                  disabled={verify.isPending}
                  onClick={() => verify.mutate(c.domain)}
                >
                  Verify
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove.mutate(c.domain)}
                >
                  Cancel
                </Button>
              </div>
              <dl className="grid gap-1 rounded-md bg-muted p-2 text-caption">
                <div className="grid gap-x-2 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
                  <dt className="text-body">Type</dt>
                  <dd className="font-mono text-ink">TXT</dd>
                </div>
                <Copyable label="Name" value={c.record} />
                <div className="grid gap-x-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-center">
                  <dt className="text-body">Value</dt>
                  <dd className="min-w-0">
                    <SecretValue
                      value={c.value}
                      what="record value"
                      testId="sso-record-value"
                    />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
      >
        <Field label="Add a domain">
          <TextInput
            value={domain}
            placeholder="college.edu"
            onChange={(e) => setDomain(e.target.value)}
            className="w-64"
          />
        </Field>
        <Button
          type="submit"
          variant="outline"
          disabled={!domain.trim() || add.isPending}
        >
          Add
        </Button>
      </form>
      {message && <FormMessage message={message} />}
    </Card>
  )
}

/** One line of the record to add, copied with one press. */
function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-x-2 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
      <dt className="text-body">{label}</dt>
      <dd className="min-w-0 font-mono break-all text-ink">{value}</dd>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(value)
          setCopied(true)
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}
