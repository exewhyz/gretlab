"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { accentProblem, CANVAS, onAccent } from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextInput } from "@/components/form"
import { Card } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

import type { getBranding } from "@/features/orgs/branding"
import type { Message } from "./manage-shared"

type Brand = ApiResult<typeof getBranding>

/** Sends the logo as form data; answers with the branding or throws a readable message. */
async function uploadLogo(slug: string, file: File): Promise<Brand> {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch(`/api/v1/orgs/${slug}/branding/logo`, {
    method: "POST",
    body: form,
  })
  const data = (await response.json().catch(() => null)) as
    (Brand & { error?: { message: string } }) | null
  if (!response.ok || !data)
    throw new Error(data?.error?.message ?? "The logo didn't upload.")
  return data
}

/**
 * Manage › Settings › Branding: the organization's logo and brand colour, worn on its pages,
 * certificates and PDFs in place of GretLab's orange (features/orgs/branding.ts). Only for
 * whoever may change settings; anyone else sees nothing here.
 */
export function BrandingCard({ slug }: { slug: string }) {
  const client = useQueryClient()
  const { data } = useQuery({
    queryKey: ["org", slug, "branding"],
    queryFn: () => api<Brand>(`/orgs/${slug}/branding`),
    throwOnError: false,
    retry: false,
  })
  if (!data) return null
  return (
    <BrandingForm
      key={`${data.logo}|${data.accent}`}
      slug={slug}
      initial={data}
      onSaved={(next) => {
        client.setQueryData(["org", slug, "branding"], next)
        // The frame wears the new logo and colour.
        void client.invalidateQueries({ queryKey: ["org", slug] })
      }}
    />
  )
}

function BrandingForm({
  slug,
  initial,
  onSaved,
}: {
  slug: string
  initial: Brand
  onSaved: (next: Brand) => void
}) {
  const [accent, setAccent] = useState(initial.accent ?? "")
  const [message, setMessage] = useState<Message>(null)
  const fail = (e: Error) => setMessage({ text: e.message, kind: "err" })
  const colour = /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : null
  const problem = accent ? accentProblem(accent) : null
  const saveColour = useMutation({
    mutationFn: (value: string | null) =>
      api<Brand>(`/orgs/${slug}/branding`, {
        method: "PUT",
        body: { accent: value },
      }),
    onSuccess: onSaved,
    onError: fail,
    meta: { success: "Brand colour saved.", quiet: true },
  })
  const upload = useMutation({
    mutationFn: (file: File) => uploadLogo(slug, file),
    onSuccess: onSaved,
    onError: fail,
    meta: { success: "Logo saved.", quiet: true },
  })
  const remove = useMutation({
    mutationFn: () =>
      api<Brand>(`/orgs/${slug}/branding/logo`, { method: "DELETE" }),
    onSuccess: onSaved,
    onError: fail,
    meta: { success: "Logo removed.", quiet: true },
  })
  return (
    <Card className="grid gap-4" data-testid="branding-card">
      <div>
        <h2 className="text-title-sm text-ink">Branding</h2>
        <p className="text-body-sm text-body">
          Your logo and colour on your organization&apos;s pages, its
          certificates and its PDFs (report cards, transfer certificates, ID
          cards), in place of GretLab&apos;s.
        </p>
      </div>
      <div className="grid gap-2">
        <span className="text-body-sm font-medium text-ink">Logo</span>
        <div className="flex flex-wrap items-center gap-3">
          {initial.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- an uploaded image, served by redirect
            <img
              src={initial.logo}
              alt="Your logo"
              data-testid="branding-logo"
              className="size-16 rounded-md border border-hairline bg-card object-contain p-1"
            />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-md border border-dashed border-hairline-strong text-caption text-body">
              None
            </span>
          )}
          <div className="grid gap-1.5">
            <Input
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Logo image"
              disabled={upload.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0]
                setMessage(null)
                if (file) upload.mutate(file)
                event.target.value = ""
              }}
            />
            <span className="text-caption text-body">
              PNG or JPEG, up to 2 MB. Square works best.
            </span>
          </div>
          {initial.logo && (
            <ConfirmButton
              size="sm"
              variant="ghost"
              title="Remove the logo?"
              description="Your pages and documents go back to showing your name's initials."
              confirmLabel="Remove logo"
              onConfirm={() => remove.mutate()}
            >
              Remove
            </ConfirmButton>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <Field
          label="Brand colour"
          help="Buttons, links and the current page wear it. It must show up on both the light and dark page."
        >
          <div className="flex items-center gap-2">
            <Input
              type="color"
              aria-label="Pick a colour"
              value={colour ?? "#f54e00"}
              onChange={(event) => {
                setAccent(event.target.value)
                setMessage(null)
              }}
              className="h-9 w-12 cursor-pointer p-1"
            />
            <TextInput
              value={accent}
              placeholder="GretLab's orange"
              aria-label="Colour as hex"
              onChange={(event) => {
                setAccent(event.target.value.trim())
                setMessage(null)
              }}
              className="w-36 font-mono"
            />
          </div>
        </Field>
        {colour && <Preview colour={colour} />}
        {problem && <FormMessage message={{ text: problem, kind: "err" }} />}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
        <span className="flex-1">
          <FormMessage message={message} />
        </span>
        {initial.accent && (
          <Button
            variant="ghost"
            disabled={saveColour.isPending}
            onClick={() => {
              setAccent("")
              saveColour.mutate(null)
            }}
          >
            Use GretLab&apos;s colour
          </Button>
        )}
        <Button
          disabled={
            saveColour.isPending ||
            !colour ||
            !!problem ||
            colour === initial.accent
          }
          onClick={() => saveColour.mutate(colour)}
        >
          Save colour
        </Button>
      </div>
    </Card>
  )
}

/** The colour on a button and as a link, on the light and the dark page. */
function Preview({ colour }: { colour: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="branding-preview">
      {(["light", "dark"] as const).map((theme) => (
        <div
          key={theme}
          className="flex items-center gap-3 rounded-md border border-hairline p-3"
          style={{ background: CANVAS[theme] }}
        >
          <span
            className="rounded-md px-3 py-1.5 text-body-sm font-medium"
            style={{ background: colour, color: onAccent(colour) }}
          >
            Submit
          </span>
          <span
            className="text-body-sm font-medium underline"
            style={{ color: colour }}
          >
            A link
          </span>
          <span
            className="ml-auto text-caption"
            style={{ color: theme === "light" ? "#5a5852" : "#b8b5ab" }}
          >
            {theme === "light" ? "Light" : "Dark"}
          </span>
        </div>
      ))}
    </div>
  )
}
