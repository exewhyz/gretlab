"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { ORG_TYPE_CONFIG, type OrgType } from "@workspace/judge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { Check, Field, FormMessage, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { KindPicker } from "@/features/orgs/components/kind-picker"
import { orgPages } from "@/lib/paths"

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

/** /schools/new: register a school (or college, cohort…) and set it up. */
export function SchoolSignup() {
  const router = useRouter()
  const { data, error } = useQuery({
    queryKey: ["schools", "signup"],
    queryFn: () => api<{ mode: "off" | "review" | "open" }>("/schools/signup"),
  })
  const year = new Date().getFullYear()
  const [form, setForm] = useState({
    name: "",
    slug: "",
    type: "school" as OrgType,
  })
  const [slugTouched, setSlugTouched] = useState(false)
  const [kindConfirmed, setKindConfirmed] = useState(false)
  const [withYear, setWithYear] = useState(true)
  const [yearForm, setYearForm] = useState({
    name: `${year}-${year + 1}`,
    startsOn: `${year}-06-01`,
    endsOn: `${year + 1}-05-31`,
  })
  const [withGrades, setWithGrades] = useState(true)
  const [grades, setGrades] = useState({
    from: "1",
    to: "10",
    sections: "A, B",
  })
  const levels = ORG_TYPE_CONFIG[form.type].groupLevels
  const twoLevels = levels.length > 1
  const sections = grades.sections
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const send = useMutation({
    mutationFn: () =>
      api<{ slug: string; name: string; pending: boolean }>("/schools", {
        body: {
          ...form,
          year: withYear ? yearForm : null,
          grades:
            withGrades && twoLevels
              ? { from: Number(grades.from), to: Number(grades.to), sections }
              : null,
        },
      }),
    onSuccess: (r) => {
      if (!r.pending) router.push(orgPages(r.slug).home)
    },
  })
  if (!data) return <Loading error={error} />
  if (data.mode === "off")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registering a school is switched off here</CardTitle>
          <CardDescription>
            Ask the site&apos;s admins to set it up for you.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  if (send.data?.pending)
    return (
      <Card data-testid="signup-pending">
        <CardHeader>
          <CardTitle>{send.data.name} is registered</CardTitle>
          <CardDescription>
            It&apos;s waiting for the platform&apos;s approval. You&apos;ll get
            a notification and an email when it&apos;s ready; then add your
            staff, classes and students.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/orgs" className={buttonVariants({ variant: "outline" })}>
            Back to organizations
          </Link>
        </CardContent>
      </Card>
    )
  const grade = levels[0] ?? "Grade"
  const count =
    withGrades && twoLevels
      ? Math.max(0, Number(grades.to) - Number(grades.from) + 1) *
        sections.length
      : 0
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => (e.preventDefault(), send.mutate())}
    >
      <div>
        <h1 className="text-display-sm text-ink">Register your school</h1>
        <p className="text-body-sm text-muted-foreground">
          You&apos;ll be its owner.{" "}
          {data.mode === "review" &&
            "A platform admin approves it before it opens."}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>About it</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <TextInput
              value={form.name}
              placeholder="Greenfield Public School"
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                  slug: slugTouched ? form.slug : toSlug(e.target.value),
                })
              }
            />
          </Field>
          <Field
            label="Web address"
            help={`Its pages will be at /orgs/${form.slug || "your-school"}`}
          >
            <TextInput
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true)
                setForm({ ...form, slug: e.target.value.toLowerCase() })
              }}
            />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <Card>
          <CardHeader>
            <CardTitle>What kind of organization is it?</CardTitle>
            <CardDescription>
              This decides how it's organized, what it calls things, and which
              features it has.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KindPicker
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              confirmed={kindConfirmed}
              onConfirm={setKindConfirmed}
            />
          </CardContent>
        </Card>
        <CardHeader>
          <CardTitle>Set it up now</CardTitle>
          <CardDescription>
            Optional; everything can be changed later.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Check
            label="Add this academic year"
            checked={withYear}
            onCheckedChange={setWithYear}
          />
          {withYear && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Year">
                <TextInput
                  value={yearForm.name}
                  onChange={(e) =>
                    setYearForm({ ...yearForm, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Starts">
                <TextInput
                  type="date"
                  value={yearForm.startsOn}
                  onChange={(e) =>
                    setYearForm({ ...yearForm, startsOn: e.target.value })
                  }
                />
              </Field>
              <Field label="Ends">
                <TextInput
                  type="date"
                  value={yearForm.endsOn}
                  onChange={(e) =>
                    setYearForm({ ...yearForm, endsOn: e.target.value })
                  }
                />
              </Field>
            </div>
          )}
          {twoLevels && (
            <>
              <Check
                label={`Add ${grade.toLowerCase()}s and ${levels[1]!.toLowerCase()}s`}
                checked={withGrades}
                onCheckedChange={setWithGrades}
              />
              {withGrades && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={`First ${grade.toLowerCase()}`}>
                    <TextInput
                      type="number"
                      min={1}
                      max={12}
                      value={grades.from}
                      onChange={(e) =>
                        setGrades({ ...grades, from: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={`Last ${grade.toLowerCase()}`}>
                    <TextInput
                      type="number"
                      min={1}
                      max={12}
                      value={grades.to}
                      onChange={(e) =>
                        setGrades({ ...grades, to: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label={`${levels[1]}s in each`}
                    help="Separate with commas."
                  >
                    <TextInput
                      value={grades.sections}
                      onChange={(e) =>
                        setGrades({ ...grades, sections: e.target.value })
                      }
                    />
                  </Field>
                </div>
              )}
              {count > 0 && (
                <p
                  className="text-caption text-muted-foreground"
                  data-testid="signup-preview"
                >
                  {grade} {grades.from} to {grade} {grades.to}, each with{" "}
                  {sections.join(", ")}: {count} {levels[1]!.toLowerCase()}s.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {send.error && (
        <FormMessage message={{ text: send.error.message, kind: "err" }} />
      )}
      <div>
        <Button
          type="submit"
          disabled={
            send.isPending || !form.name || !form.slug || !kindConfirmed
          }
        >
          Register
        </Button>
      </div>
    </form>
  )
}

/** "Register your school" on the organizations page, when sign-ups are allowed. */
export function SignupLink() {
  const { data } = useQuery({
    queryKey: ["schools", "signup"],
    queryFn: () => api<{ mode: "off" | "review" | "open" }>("/schools/signup"),
    retry: false,
  })
  if (!data || data.mode === "off") return null
  return (
    <Link
      href="/schools/new"
      className={buttonVariants({ variant: "outline" })}
      data-testid="signup-link"
    >
      Register your school
    </Link>
  )
}
