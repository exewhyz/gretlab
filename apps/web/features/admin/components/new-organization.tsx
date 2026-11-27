"use client"

import {
  AddressStatus,
  useAddressCheck,
} from "@/features/orgs/components/address-status"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { KINDS, type OrgType } from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { EditorSheet } from "@/components/editor-sheet"
import { Field, TextInput } from "@/components/form"
import { Steps } from "@/components/steps"
import {
  KindConfirm,
  KindPicker,
  ReviewRow,
} from "@/features/orgs/components/kind-picker"
import { slugify } from "@/features/problems/schemas"
import { api } from "@/lib/api/client"

const STEPS = ["Kind", "Details", "Review"] as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Dashboard › Organizations › New organization: the kind first (it can't change), then its
 * name, address and first owner, then a review that asks to confirm the kind before creating.
 */
export function NewOrganizationSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (org: { name: string; slug: string }) => void
}) {
  const client = useQueryClient()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    name: "",
    slug: "",
    type: "college" as OrgType,
    ownerEmail: "",
    referralCode: "",
  })
  const [slugTouched, setSlugTouched] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const create = useMutation({
    mutationFn: () =>
      api<{ name: string; slug: string }>("/admin/organizations", {
        body: { ...form, referralCode: form.referralCode.trim() || undefined },
      }),
    onSuccess: (org) => {
      void client.invalidateQueries({ queryKey: ["admin", "organizations"] })
      onCreated(org)
    },
    meta: { quiet: true },
  })
  const address = useAddressCheck(form.slug)
  const detailsOk =
    form.name.trim().length > 0 &&
    /^[a-z0-9][a-z0-9-]*$/.test(form.slug) &&
    address.free === true &&
    EMAIL.test(form.ownerEmail.trim())
  const why =
    step === 1 && !detailsOk
      ? !form.name.trim()
        ? "Give it a name."
        : !/^[a-z0-9][a-z0-9-]*$/.test(form.slug)
          ? "The address takes small letters, numbers and dashes."
          : address.free === false
            ? (address.problem ?? "That address can't be used.")
            : address.free === null
              ? "Checking the address…"
              : "Enter the owner's email."
      : null
  const last = step === STEPS.length - 1
  return (
    <EditorSheet
      testId="new-organization"
      title="New organization"
      description="Its first owner manages it once they sign in."
      width="52rem"
      submitLabel={last ? "Create organization" : "Next"}
      submitDisabled={
        create.isPending || (step === 1 && !detailsOk) || (last && !confirmed)
      }
      error={create.error?.message ?? why}
      onClose={onClose}
      onSubmit={() => (last ? create.mutate() : setStep(step + 1))}
      extra={
        step > 0 && (
          <Button variant="outline" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )
      }
    >
      <Steps steps={STEPS} current={step} onStep={setStep} />
      {step === 0 && (
        <KindPicker
          value={form.type}
          onChange={(type) => {
            setForm({ ...form, type })
            setConfirmed(false)
          }}
        />
      )}
      {step === 1 && (
        <div className="grid max-w-lg gap-4">
          <Field label="Name">
            <TextInput
              autoFocus
              value={form.name}
              placeholder={`Greenfield ${KINDS[form.type].label}`}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                  slug: slugTouched
                    ? form.slug
                    : slugify(e.target.value).slice(0, 48),
                })
              }
            />
          </Field>
          <Field
            label="Address"
            help={`Its pages: /orgs/${form.slug || "address"}`}
          >
            <TextInput
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true)
                setForm({ ...form, slug: e.target.value.toLowerCase() })
              }}
            />
          </Field>
          <AddressStatus check={address} />
          <Field
            label="Owner's email"
            help="They're invited as its first owner and manage it after signing in."
          >
            <TextInput
              type="email"
              value={form.ownerEmail}
              onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            />
          </Field>
          <Field
            label="Referral code (optional)"
            help="Whoever referred it earns from its first months of payments."
          >
            <TextInput
              value={form.referralCode}
              onChange={(e) =>
                setForm({ ...form, referralCode: e.target.value.toUpperCase() })
              }
            />
          </Field>
        </div>
      )}
      {last && (
        <div className="grid gap-4">
          <dl className="rounded-lg bg-card px-4 ring-1 ring-foreground/10">
            <ReviewRow label="Kind">{KINDS[form.type].label}</ReviewRow>
            <ReviewRow label="Name">{form.name}</ReviewRow>
            <ReviewRow label="Address">/orgs/{form.slug}</ReviewRow>
            <ReviewRow label="First owner">{form.ownerEmail}</ReviewRow>
            {form.referralCode.trim() && (
              <ReviewRow label="Referred with">
                {form.referralCode.trim()}
              </ReviewRow>
            )}
            <ReviewRow label="Groups">
              {KINDS[form.type].groupLevels.join(" › ")}
            </ReviewRow>
          </dl>
          <KindConfirm
            kind={form.type}
            confirmed={confirmed}
            onConfirm={setConfirmed}
          />
        </div>
      )}
    </EditorSheet>
  )
}
