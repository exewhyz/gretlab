"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"

import { BuildingsIcon } from "@phosphor-icons/react"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Progress } from "@workspace/ui/components/progress"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { Field, TextArea, TextInput } from "@/components/form"
import { Row, Section } from "@/components/settings-sections"
import { SecuritySettings } from "@/features/auth/components/security"
import { api, ApiRequestError } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { toast } from "@/lib/toast"
import type { accountProfile } from "@/features/profile/server"
import { accountProfileSchema } from "@/features/profile/schemas"

type Profile = ApiResult<typeof accountProfile>
export type AccountTab = "profile" | "security"

/** Account: the person's profile and their sign-in security, as tabs with their own address. */
export function AccountPage({ tab }: { tab: AccountTab }) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display-sm text-ink">Account</h1>
          <p className="text-body-sm text-body">
            Your profile, and how you sign in.{" "}
            <Link
              href="/notifications"
              className="underline underline-offset-2 hover:text-ink"
            >
              Notification settings
            </Link>
          </p>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(next) => {
          const target = next === "security" ? "/account/security" : "/account"
          if (target !== pathname) router.replace(target, { scroll: false })
        }}
      >
        <TabsList aria-label="Account">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "profile" ? <ProfileForm /> : <SecuritySettings />}
    </div>
  )
}

type Draft = Omit<Profile, "email" | "completeness" | "organizations">

function ProfileForm() {
  const { data, error } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => api<Profile>("/me/profile"),
  })
  if (error) {
    return (
      <p role="alert" className="text-body-sm text-destructive">
        {error.message}
      </p>
    )
  }
  if (!data) return <ProfileSkeleton />
  return <ProfileEditor key={JSON.stringify(data)} profile={data} />
}

function ProfileSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading profile">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  )
}

function ProfileEditor({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient()
  const { email, completeness, organizations, ...initial } = profile
  const [form, setForm] = useState<Draft>(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({})
  const set = (key: keyof Draft, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const save = useMutation({
    mutationFn: (body: Draft) =>
      api<Profile>("/me/profile", { method: "PATCH", body }),
    onSuccess: (next) => {
      queryClient.setQueryData(["me", "profile"], next)
      // The header shows the name.
      void queryClient.invalidateQueries({ queryKey: ["me"], exact: true })
      toast.success("Profile saved")
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === "handle_taken")
        setErrors({ handle: e.message })
      toast.error(e.message)
    },
  })
  const submit = () => {
    const parsed = accountProfileSchema.safeParse(form)
    if (!parsed.success) {
      const found: typeof errors = {}
      for (const issue of parsed.error.issues)
        found[issue.path[0] as keyof Draft] ??= issue.message
      setErrors(found)
      return
    }
    save.mutate(form)
  }
  const changed = JSON.stringify(form) !== JSON.stringify(initial)
  const percent = Math.round((completeness.done / completeness.total) * 100)
  const text = (
    key: keyof Draft,
    label: string,
    props: { help?: string; placeholder?: string; type?: string } = {}
  ) => (
    <div className="grid content-start gap-1">
      <Field label={label} help={props.help}>
        <TextInput
          type={props.type ?? "text"}
          value={form[key]}
          placeholder={props.placeholder}
          aria-invalid={Boolean(errors[key])}
          onChange={(e) => set(key, e.target.value)}
        />
      </Field>
      {errors[key] && (
        <p className="text-caption text-destructive">{errors[key]}</p>
      )}
    </div>
  )

  return (
    <div className="grid max-w-4xl gap-8">
      <Section
        title="Profile"
        description="How you appear on GretLab: on your public page, leaderboards and to your classmates."
        padded
        status={
          <div className="mt-2 grid gap-2" data-testid="profile-completeness">
            <div className="flex items-baseline justify-between text-caption">
              <span className="text-ink">Profile complete</span>
              <span className="text-body tabular-nums">
                {completeness.done} of {completeness.total}
              </span>
            </div>
            <Progress value={percent} aria-label="Profile complete" />
            {completeness.missing.length ? (
              <ul className="grid gap-0.5 text-caption text-body">
                {completeness.missing.map((m) => (
                  <li key={m.key}>Add {m.label.toLowerCase()}</li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-body">Complete. Nice.</p>
            )}
          </div>
        }
      >
        <div className="grid gap-3 min-[720px]:grid-cols-2">
          {text("name", "Name")}
          {text("handle", "Profile address", {
            help: "Your public page is /u/ followed by this.",
          })}
        </div>
        {text("headline", "Headline", {
          placeholder: "Second-year CSE student, or Maths teacher",
        })}
        {text("city", "City")}
        <div className="grid gap-1">
          <Field label="About you">
            <TextArea
              rows={4}
              value={form.bio}
              aria-invalid={Boolean(errors.bio)}
              onChange={(e) => set("bio", e.target.value)}
            />
          </Field>
          {errors.bio && (
            <p className="text-caption text-destructive">{errors.bio}</p>
          )}
        </div>
      </Section>
      <Section
        title="Contact"
        description="How GretLab and your organizations reach you."
        padded
      >
        <Field
          label="Email"
          help="Where sign-in links and notices go. It can't be changed here."
        >
          <TextInput value={email} readOnly className="bg-muted" />
        </Field>
        {text("phone", "Phone", {
          type: "tel",
          help: "Kept sealed. Only you, your linked parents and staff of your organizations who may see members' details see it.",
        })}
      </Section>
      <Section
        title="Links"
        description="Where people can see more of your work."
        padded
      >
        {text("website", "Website", { placeholder: "https://…" })}
        <div className="grid gap-3 min-[720px]:grid-cols-2">
          {text("github", "GitHub username")}
          {text("linkedin", "LinkedIn", {
            placeholder: "https://www.linkedin.com/in/…",
          })}
        </div>
      </Section>
      {organizations.length > 0 && (
        <Section
          title="In your organizations"
          description="Each one keeps its own details about you: your class, role, designation, and who's linked to you."
        >
          {organizations.map((o) => (
            <Row
              key={o.slug}
              icon={<BuildingsIcon aria-hidden />}
              title={o.name}
              detail="Your profile there"
              action={
                <Link
                  href={o.profile}
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" })
                  )}
                >
                  Open
                </Link>
              }
            />
          ))}
        </Section>
      )}
      {/* One save for the whole form, kept in view while there's something to save. */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-3 border-t border-hairline bg-canvas/95 py-3 backdrop-blur",
          changed && "sticky bottom-0 z-10"
        )}
      >
        {changed && (
          <span className="mr-auto text-caption text-body">
            Unsaved changes
          </span>
        )}
        {changed && (
          <Button variant="ghost" onClick={() => setForm(initial)}>
            Undo changes
          </Button>
        )}
        <Button disabled={save.isPending || !changed} onClick={submit}>
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  )
}
