"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDate } from "@/lib/format"

interface Data {
  issued: { id: string; code: string; title: string; student: string; issuedAt: string; revoked: boolean }[]
  students: { id: string; name: string }[]
}

/** A class's certificates, for its teachers: give them, see them, revoke one. */
export function ClassCertificates({
  slug,
  groupId,
  courses,
}: {
  slug: string
  groupId: string
  courses: { id: string; title: string }[]
}) {
  const base = `/orgs/${slug}/classes/${groupId}/certificates`
  const key = ["org", slug, "class", groupId, "certificates"]
  const client = useQueryClient()
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api<Data>(base) })
  const [giving, setGiving] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const revoke = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  if (!data) return <Loading error={error} />
  return (
    <section className="grid gap-2 rounded-lg border border-hairline bg-card p-3" data-testid="class-certificates">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-ink">Certificates</h2>
          <p className="text-caption">
            {data.issued.length
              ? `${data.issued.filter((c) => !c.revoked).length} given in this class. Each has a public page anyone can check.`
              : "For finishing a course, or one you write. Each has a public page anyone can check."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setGiving(true)}>
          Give certificates
        </Button>
      </div>
      {result && <FormMessage message={{ text: result, kind: "ok" }} />}
      {revoke.error && <FormMessage message={{ text: revoke.error.message, kind: "err" }} />}
      {data.issued.length > 0 && (
        <ul className="grid gap-1">
          {data.issued.map((c) => (
            <li key={c.id} data-testid="issued-certificate" className="flex flex-wrap items-center gap-2 text-body-sm">
              <span className="min-w-40 text-ink">{c.student}</span>
              <span className="flex-1 text-caption">
                {c.title} · {formatDate(c.issuedAt)}
              </span>
              <Link href={`/certificates/${c.code}`} className="font-mono text-xs underline-offset-2 hover:underline">
                {c.code}
              </Link>
              {c.revoked ? (
                <span className="text-xs text-destructive">Revoked</span>
              ) : (
                <ConfirmButton
                  variant="ghost"
                  size="xs"
                  title={`Revoke ${c.student}'s certificate?`}
                  description="Its public page will say it was revoked. This can't be undone."
                  confirmLabel="Revoke"
                  onConfirm={() => revoke.mutate(c.id)}
                >
                  Revoke
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {giving && (
        <GiveDialog
          base={base}
          courses={courses}
          students={data.students}
          onDone={(message) => {
            setGiving(false)
            if (message) {
              setResult(message)
              void client.invalidateQueries({ queryKey: key })
            }
          }}
        />
      )}
    </section>
  )
}

function GiveDialog({
  base,
  courses,
  students,
  onDone,
}: {
  base: string
  courses: { id: string; title: string }[]
  students: Data["students"]
  onDone: (message?: string) => void
}) {
  const [kind, setKind] = useState<"course" | "custom">(courses.length ? "course" : "custom")
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "")
  const [title, setTitle] = useState("")
  const [detail, setDetail] = useState("")
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const give = useMutation({
    mutationFn: () =>
      api<{ issued: number }>(base, {
        body: kind === "course" ? { kind, courseId } : { kind, title, detail, userIds: [...chosen] },
      }),
    onSuccess: (r) =>
      onDone(
        r.issued === 0
          ? kind === "course"
            ? "Nobody new has finished that course yet."
            : "Nobody was chosen."
          : `Gave ${r.issued} ${r.issued === 1 ? "certificate" : "certificates"}. Students were told.`
      ),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Give certificates</DialogTitle>
          <DialogDescription>Students are told, and find them under My certificates.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={kind} onValueChange={(v) => setKind(v as typeof kind)} className="gap-2">
          <label className="flex items-start gap-2 text-body-sm">
            <RadioGroupItem value="course" aria-label="For finishing a course" disabled={courses.length === 0} />
            <span>
              <span className="text-ink">For finishing a course</span>
              <span className="block text-caption">
                Everyone in the class who finished every item, once each.
                {courses.length === 0 && " This class has no course."}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-body-sm">
            <RadioGroupItem value="custom" aria-label="One I write" />
            <span>
              <span className="text-ink">One I write</span>
              <span className="block text-caption">Such as &ldquo;Best project&rdquo;, for students you choose.</span>
            </span>
          </label>
        </RadioGroup>
        {kind === "course" ? (
          <Field label="Course">
            <SelectInput aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : (
          <>
            <Field label="Certificate">
              <TextInput aria-label="Certificate title" placeholder="Best project, Python lab" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Details (optional)">
              <TextInput aria-label="Details" placeholder="For a well-tested library manager." value={detail} onChange={(e) => setDetail(e.target.value)} />
            </Field>
            <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-hairline p-2">
              {students.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-body-sm">
                  <Checkbox
                    aria-label={`Give to ${s.name}`}
                    checked={chosen.has(s.id)}
                    onCheckedChange={(checked) =>
                      setChosen((all) => {
                        const next = new Set(all)
                        if (checked) next.add(s.id)
                        else next.delete(s.id)
                        return next
                      })
                    }
                  />
                  {s.name}
                </label>
              ))}
              {students.length === 0 && <p className="text-caption">No students in this class.</p>}
            </div>
          </>
        )}
        {give.error && <FormMessage message={{ text: give.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button
            disabled={give.isPending || (kind === "course" ? !courseId : !title.trim() || chosen.size === 0)}
            onClick={() => give.mutate()}
          >
            Give
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
