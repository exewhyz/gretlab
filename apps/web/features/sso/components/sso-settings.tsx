"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"

import { Field, FormMessage, TextInput } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
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
      <Card className="grid gap-2">
        <h2 className="text-title-sm text-ink">Your email domains</h2>
        {noDomains ? (
          <p className="text-body-sm text-body" data-testid="sso-no-domains">
            GretLab confirms which email domains your college owns before single
            sign-on can be switched on, so no one can sign in someone
            else&apos;s address. Write to us with your domains (for example
            college.edu).
          </p>
        ) : (
          <p className="text-body-sm text-ink" data-testid="sso-domains">
            {initial.domains.join(", ")}
          </p>
        )}
      </Card>
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
          <TextInput
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
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
